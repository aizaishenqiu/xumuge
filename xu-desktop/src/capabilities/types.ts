export interface CapabilityPackManifest {
  id: string;
  name: string;
  description: string;
  version?: string;
  agentToolHints?: string;
  fileExtensions?: string[];
  officeTools?: boolean;
  helpDoc?: string;
  /** Bind to an agency role id (catalog or custom). Empty = all roles / Boss chat. */
  roleId?: string;
  /** Bind to a hired employee id (playbooks). */
  employeeId?: string;
  /** Absolute path of the on-disk file (user-owned skills). */
  sourcePath?: string;
}

export interface InstalledCapabilityPack {
  manifest: CapabilityPackManifest;
  enabled: boolean;
  bundled?: boolean;
  /** Copied into the user skills folder; survives uninstall. */
  userOwned?: boolean;
}

export interface CapabilityPackState {
  installed: InstalledCapabilityPack[];
}
