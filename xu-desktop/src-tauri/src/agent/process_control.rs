//! 后台子进程的无窗口启动、超时等待与整棵进程树终止。
//!
//! @author qiuye <yjk150@qq.com>
//! @date 2026-08-31
//! @version 1.1.0
//! @category ToolPolicy
//! @algo isolated-env-bounded-pipe-process-tree

use std::ffi::OsString;
use std::io::Read;
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

#[cfg(windows)]
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;
pub const MAX_CAPTURE_BYTES_PER_STREAM: usize = 1024 * 1024;

const CHILD_ENV_ALLOWLIST: &[&str] = &[
    "APPDATA",
    "COLORTERM",
    "COMSPEC",
    "HOME",
    "LANG",
    "LC_ALL",
    "LOCALAPPDATA",
    "PATH",
    "PATHEXT",
    "PROGRAMDATA",
    "PROGRAMFILES",
    "PROGRAMFILES(X86)",
    "PROGRAMW6432",
    "SHELL",
    "SYSTEMDRIVE",
    "SYSTEMROOT",
    "TEMP",
    "TERM",
    "TMP",
    "TMPDIR",
    "USERDOMAIN",
    "USERNAME",
    "USERPROFILE",
    "WINDIR",
];

/// Returns the minimal inherited environment needed by local tools and shells.
/// Dependency: fixed allowlist only; arbitrary model-key names are never copied.
/// Failure: non-Unicode values remain lossless as `OsString`.
pub fn isolated_child_environment() -> Vec<(OsString, OsString)> {
    CHILD_ENV_ALLOWLIST
        .iter()
        .filter_map(|name| std::env::var_os(name).map(|value| (OsString::from(name), value)))
        .collect()
}

/// Clears inherited variables and restores only the fixed local-runtime allowlist.
/// Dependency: call before `spawn`/`output`; PATH and OS shell variables are retained.
/// Failure: environment setup itself is infallible; spawn reports missing runtime variables.
pub fn configure_isolated_environment(command: &mut Command) {
    command.env_clear();
    command.envs(isolated_child_environment());
}

/// Configures a background command so Windows never opens a console and Unix creates a process group.
/// Dependency: platform `CommandExt`; failure is deferred to `spawn`.
pub fn configure_background(command: &mut Command) {
    configure_isolated_environment(command);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
}

/// Terminates the child and all descendants.
/// Dependency: Windows `taskkill /T /F`; Unix negative-PID process-group kill.
/// Failure: returns an error after a best-effort direct child kill.
pub fn terminate_process_tree(child: &mut Child) -> Result<(), String> {
    let pid = child.id();
    #[cfg(windows)]
    {
        let mut kill = Command::new("taskkill");
        kill.args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        configure_background(&mut kill);
        let status = kill
            .status()
            .map_err(|e| format!("taskkill 启动失败: {e}"))?;
        let _ = child.kill();
        let _ = child.wait();
        if status.success() {
            Ok(())
        } else {
            Err(format!("taskkill /T /F 失败: {status}"))
        }
    }
    #[cfg(unix)]
    {
        let group = format!("-{pid}");
        let term = Command::new("kill")
            .args(["-TERM", "--", &group])
            .status()
            .map_err(|e| format!("kill process group 启动失败: {e}"))?;
        if !term.success() {
            let _ = child.kill();
        }
        thread::sleep(Duration::from_millis(120));
        if child.try_wait().ok().flatten().is_none() {
            let _ = Command::new("kill").args(["-KILL", "--", &group]).status();
        }
        let _ = child.wait();
        Ok(())
    }
    #[cfg(not(any(windows, unix)))]
    {
        child.kill().map_err(|e| e.to_string())?;
        let _ = child.wait();
        Ok(())
    }
}

#[derive(Debug)]
pub struct CapturedOutput {
    pub status: ExitStatus,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}

#[derive(Clone, Copy, Debug)]
enum OutputStream {
    Stdout,
    Stderr,
}

impl OutputStream {
    fn label(self) -> &'static str {
        match self {
            Self::Stdout => "stdout",
            Self::Stderr => "stderr",
        }
    }
}

struct BoundedRead {
    bytes: Vec<u8>,
    exceeded: bool,
}

/// Waits for a child while bounding each output stream and enforcing a timeout.
/// Dependency: piped stdout/stderr; dedicated readers drain pipes without retaining overflow.
/// Failure: timeout or output overflow terminates the owned process tree before returning an error.
pub fn wait_with_output_timeout(
    child: &mut Child,
    timeout: Duration,
) -> Result<CapturedOutput, String> {
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let (overflow_tx, overflow_rx) = mpsc::channel();
    let stdout_tx = overflow_tx.clone();
    let stdout_reader = thread::spawn(move || {
        read_bounded(
            stdout,
            MAX_CAPTURE_BYTES_PER_STREAM,
            OutputStream::Stdout,
            stdout_tx,
        )
    });
    let stderr_reader = thread::spawn(move || {
        read_bounded(
            stderr,
            MAX_CAPTURE_BYTES_PER_STREAM,
            OutputStream::Stderr,
            overflow_tx,
        )
    });
    let started = Instant::now();
    let status = loop {
        if let Ok(stream) = overflow_rx.try_recv() {
            let kill_result = terminate_process_tree(child);
            let _ = stdout_reader.join();
            let _ = stderr_reader.join();
            return Err(output_limit_message(stream, kill_result));
        }
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if started.elapsed() < timeout => thread::sleep(Duration::from_millis(20)),
            Ok(None) => {
                let kill_result = terminate_process_tree(child);
                let _ = stdout_reader.join();
                let _ = stderr_reader.join();
                return Err(match kill_result {
                    Ok(()) => format!("进程超时（{} ms），已终止进程树", timeout.as_millis()),
                    Err(e) => format!(
                        "进程超时（{} ms），终止进程树失败: {e}",
                        timeout.as_millis()
                    ),
                });
            }
            Err(e) => {
                let kill_result = terminate_process_tree(child);
                let _ = stdout_reader.join();
                let _ = stderr_reader.join();
                return Err(match kill_result {
                    Ok(()) => format!("等待进程失败: {e}；已终止进程树"),
                    Err(kill_error) => {
                        format!("等待进程失败: {e}；终止进程树失败: {kill_error}")
                    }
                });
            }
        }
    };
    let stdout = stdout_reader.join().unwrap_or(BoundedRead {
        bytes: Vec::new(),
        exceeded: false,
    });
    let stderr = stderr_reader.join().unwrap_or(BoundedRead {
        bytes: Vec::new(),
        exceeded: false,
    });
    if stdout.exceeded {
        return Err(output_limit_after_exit_message(OutputStream::Stdout));
    }
    if stderr.exceeded {
        return Err(output_limit_after_exit_message(OutputStream::Stderr));
    }
    Ok(CapturedOutput {
        status,
        stdout: stdout.bytes,
        stderr: stderr.bytes,
    })
}

fn output_limit_after_exit_message(stream: OutputStream) -> String {
    format!(
        "进程输出超限：{} 超过 {} 字节；进程已退出，超出部分已丢弃",
        stream.label(),
        MAX_CAPTURE_BYTES_PER_STREAM
    )
}

fn output_limit_message(stream: OutputStream, kill_result: Result<(), String>) -> String {
    let limit = MAX_CAPTURE_BYTES_PER_STREAM;
    match kill_result {
        Ok(()) => format!(
            "进程输出超限：{} 超过 {limit} 字节，已终止进程树",
            stream.label()
        ),
        Err(error) => format!(
            "进程输出超限：{} 超过 {limit} 字节，终止进程树失败: {error}",
            stream.label()
        ),
    }
}

fn read_bounded<R: Read + Send + 'static>(
    reader: Option<R>,
    limit: usize,
    stream: OutputStream,
    overflow_tx: mpsc::Sender<OutputStream>,
) -> BoundedRead {
    let mut result = BoundedRead {
        bytes: Vec::with_capacity(limit.min(64 * 1024)),
        exceeded: false,
    };
    if let Some(mut reader) = reader {
        let mut chunk = [0u8; 8192];
        loop {
            let read = match reader.read(&mut chunk) {
                Ok(0) | Err(_) => break,
                Ok(read) => read,
            };
            let remaining = limit.saturating_sub(result.bytes.len());
            result
                .bytes
                .extend_from_slice(&chunk[..read.min(remaining)]);
            if read > remaining && !result.exceeded {
                result.exceeded = true;
                let _ = overflow_tx.send(stream);
            }
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn isolated_child_cannot_see_model_key() {
        const KEY: &str = "XU_AUDIT_CHILD_SECRET_KEY";
        std::env::set_var(KEY, "must-not-leak");
        #[cfg(windows)]
        let mut command = {
            let mut c = Command::new("cmd");
            c.args([
                "/D",
                "/C",
                "if defined XU_AUDIT_CHILD_SECRET_KEY (exit 7) else (exit 0)",
            ]);
            c
        };
        #[cfg(unix)]
        let mut command = {
            let mut c = Command::new("sh");
            c.args(["-c", "test -z \"$XU_AUDIT_CHILD_SECRET_KEY\""]);
            c
        };
        configure_background(&mut command);
        let status = command.status().expect("start isolated child");
        std::env::remove_var(KEY);
        assert!(status.success());
    }

    #[test]
    fn output_flood_is_bounded_and_stopped() {
        #[cfg(windows)]
        let mut command = {
            let mut c = Command::new("powershell");
            c.args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "while ($true) { [Console]::Out.Write('x' * 8192) }",
            ]);
            c
        };
        #[cfg(unix)]
        let mut command = {
            let mut c = Command::new("sh");
            c.args(["-c", "while :; do printf '%08192d' 0; done"]);
            c
        };
        configure_background(&mut command);
        let mut child = command
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn output flood");
        let error = wait_with_output_timeout(&mut child, Duration::from_secs(10)).unwrap_err();
        assert!(error.contains("进程输出超限"));
        assert!(error.contains("已终止进程树"));
        assert!(child.try_wait().unwrap().is_some());
    }

    #[test]
    fn timeout_kills_spawned_process() {
        #[cfg(windows)]
        let mut command = {
            let mut c = Command::new("powershell");
            c.args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "Start-Sleep -Seconds 30",
            ]);
            c
        };
        #[cfg(unix)]
        let mut command = {
            let mut c = Command::new("sh");
            c.args(["-c", "sleep 30"]);
            c
        };
        configure_background(&mut command);
        let mut child = command
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let result = wait_with_output_timeout(&mut child, Duration::from_millis(80));
        assert!(result.unwrap_err().contains("已终止进程树"));
        assert!(child.try_wait().unwrap().is_some());
    }
}
