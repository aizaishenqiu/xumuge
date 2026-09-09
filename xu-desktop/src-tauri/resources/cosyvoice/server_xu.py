# Copyright (c) 2024 Alibaba Inc (authors: Xiang Lyu)
# Fou 补丁：CV2/CV3 传 wav 路径；stream=True 真流式；X-Sample-Rate；参考音短缓存。
#
# @author qiuye <yjk150@qq.com>
# @date 2026-09-01
# @updated 2026-09-03
# @version 1.2.0
# @category Stream
# @algo streaming-response-instance-health

import hashlib
import os
import sys
import argparse
import logging
import tempfile
import threading
import time
import uuid

logging.getLogger("matplotlib").setLevel(logging.WARNING)
from fastapi import FastAPI, UploadFile, Form, File
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import numpy as np

ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append("{}/../../..".format(ROOT_DIR))
sys.path.append("{}/../../../third_party/Matcha-TTS".format(ROOT_DIR))
from cosyvoice.cli.cosyvoice import AutoModel


app = FastAPI()
SERVER_XU_VERSION = "1.2.0"
SERVER_XU_INSTANCE_ID = uuid.uuid4().hex
SERVER_XU_MODEL_DIR = ""
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 参考音内容哈希 → 临时路径（短时复用，避免每请求重写盘）
_PROMPT_CACHE = {}
_PROMPT_LOCK = threading.Lock()
_PROMPT_TTL_SEC = 120


def _sample_rate_hz():
    rate = getattr(cosyvoice, "sample_rate", None)
    try:
        rate = int(rate) if rate is not None else 0
    except (TypeError, ValueError):
        rate = 0
    if rate >= 8000:
        return rate
    model_dir = str(getattr(cosyvoice, "model_dir", "") or "")
    low = model_dir.lower()
    if "cosyvoice2" in low or "cosyvoice3" in low or "cv2" in low:
        return 24000
    return 22050


def _stream_headers():
    return {
        "X-Sample-Rate": str(_sample_rate_hz()),
        "Cache-Control": "no-store",
    }


def _model_family(model_dir: str) -> str:
    low = model_dir.lower()
    if "cosyvoice3" in low:
        return "cosyvoice3"
    if "cosyvoice2" in low or "fun-cosyvoice" in low:
        return "cosyvoice2"
    return "cosyvoice1"


@app.get("/xu/health")
async def xu_health():
    """Report the exact Xu sidecar instance and loaded model."""
    model_dir = str(getattr(cosyvoice, "model_dir", "") or SERVER_XU_MODEL_DIR)
    return {
        "ok": True,
        "scriptVersion": SERVER_XU_VERSION,
        "instanceId": SERVER_XU_INSTANCE_ID,
        "modelDir": os.path.abspath(model_dir) if model_dir else "",
        "modelFamily": _model_family(model_dir),
        "streaming": True,
        "sampleRate": _sample_rate_hz(),
    }


def _call_inference(fn, *args, **kwargs):
    """优先 stream=True；旧版无该参数则回落。"""
    try:
        return fn(*args, stream=True, **kwargs)
    except TypeError:
        logging.warning("CosyVoice inference 不支持 stream=True，回落整段生成")
        return fn(*args, **kwargs)


def generate_data(model_output, cleanup_path=None):
    try:
        for i in model_output:
            tts_audio = (i["tts_speech"].numpy() * (2 ** 15)).astype(np.int16).tobytes()
            yield tts_audio
    finally:
        if cleanup_path:
            _release_prompt_path(cleanup_path)


def _release_prompt_path(path):
    """流结束后：若仍在缓存则只更新时间戳，否则删文件。"""
    with _PROMPT_LOCK:
        for key, (p, _ts) in list(_PROMPT_CACHE.items()):
            if p == path:
                _PROMPT_CACHE[key] = (p, time.time())
                return
    try:
        os.remove(path)
    except OSError:
        pass


def _prune_prompt_cache():
    now = time.time()
    with _PROMPT_LOCK:
        dead = [k for k, (p, ts) in _PROMPT_CACHE.items() if now - ts > _PROMPT_TTL_SEC]
        for k in dead:
            p, _ = _PROMPT_CACHE.pop(k)
            try:
                os.remove(p)
            except OSError:
                pass


async def _persist_upload(upload: UploadFile) -> str:
    """按内容哈希复用临时 wav，减少重复落盘。"""
    _prune_prompt_cache()
    data = await upload.read()
    digest = hashlib.sha256(data).hexdigest()
    with _PROMPT_LOCK:
        hit = _PROMPT_CACHE.get(digest)
        if hit and os.path.isfile(hit[0]):
            _PROMPT_CACHE[digest] = (hit[0], time.time())
            return hit[0]
    suffix = os.path.splitext(upload.filename or "prompt.wav")[1] or ".wav"
    fd, path = tempfile.mkstemp(suffix=suffix, prefix="fou-cosy-")
    os.close(fd)
    with open(path, "wb") as f:
        f.write(data)
    with _PROMPT_LOCK:
        _PROMPT_CACHE[digest] = (path, time.time())
    return path


@app.get("/inference_sft")
@app.post("/inference_sft")
async def inference_sft(tts_text: str = Form(), spk_id: str = Form()):
    model_output = _call_inference(cosyvoice.inference_sft, tts_text, spk_id)
    return StreamingResponse(
        generate_data(model_output),
        media_type="application/octet-stream",
        headers=_stream_headers(),
    )


@app.get("/inference_zero_shot")
@app.post("/inference_zero_shot")
async def inference_zero_shot(
    tts_text: str = Form(),
    prompt_text: str = Form(),
    prompt_wav: UploadFile = File(),
):
    wav_path = await _persist_upload(prompt_wav)
    model_output = _call_inference(
        cosyvoice.inference_zero_shot, tts_text, prompt_text, wav_path
    )
    return StreamingResponse(
        generate_data(model_output, wav_path),
        media_type="application/octet-stream",
        headers=_stream_headers(),
    )


@app.get("/inference_cross_lingual")
@app.post("/inference_cross_lingual")
async def inference_cross_lingual(tts_text: str = Form(), prompt_wav: UploadFile = File()):
    wav_path = await _persist_upload(prompt_wav)
    model_output = _call_inference(cosyvoice.inference_cross_lingual, tts_text, wav_path)
    return StreamingResponse(
        generate_data(model_output, wav_path),
        media_type="application/octet-stream",
        headers=_stream_headers(),
    )


@app.get("/inference_instruct")
@app.post("/inference_instruct")
async def inference_instruct(
    tts_text: str = Form(), spk_id: str = Form(), instruct_text: str = Form()
):
    model_output = _call_inference(
        cosyvoice.inference_instruct, tts_text, spk_id, instruct_text
    )
    return StreamingResponse(
        generate_data(model_output),
        media_type="application/octet-stream",
        headers=_stream_headers(),
    )


@app.get("/inference_instruct2")
@app.post("/inference_instruct2")
async def inference_instruct2(
    tts_text: str = Form(),
    instruct_text: str = Form(),
    prompt_wav: UploadFile = File(),
):
    wav_path = await _persist_upload(prompt_wav)
    model_output = _call_inference(
        cosyvoice.inference_instruct2, tts_text, instruct_text, wav_path
    )
    return StreamingResponse(
        generate_data(model_output, wav_path),
        media_type="application/octet-stream",
        headers=_stream_headers(),
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=50000)
    parser.add_argument("--model_dir", type=str, default="iic/CosyVoice2-0.5B")
    args = parser.parse_args()
    SERVER_XU_MODEL_DIR = args.model_dir
    cosyvoice = AutoModel(model_dir=args.model_dir)
    logging.info(
        "Xu Cosy sidecar version=%s instance=%s model=%s",
        SERVER_XU_VERSION,
        SERVER_XU_INSTANCE_ID,
        os.path.abspath(args.model_dir),
    )
    uvicorn.run(app, host="127.0.0.1", port=args.port)
