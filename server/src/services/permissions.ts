export type Role = 'Admin' | 'Engineer' | 'Viewer';

export interface PermissionFlags {
  canEditDevices: boolean;
  canManageUsers: boolean;
  canEditTopology: boolean;
  canImportConfig: boolean;
  canAcknowledgeAlerts: boolean;
  canModifySettings: boolean;
  canRebootDevices: boolean;
}

/** Defaults per role, identical to the DEFAULT_*_PERMISSIONS objects in AuthContext. */
export const DEFAULT_PERMISSIONS: Record<Role, PermissionFlags> = {
  Admin: {
    canEditDevices: true,
    canManageUsers: true,
    canEditTopology: true,
    canImportConfig: true,
    canAcknowledgeAlerts: true,
    canModifySettings: true,
    canRebootDevices: true,
  },
  Engineer: {
    canEditDevices: false,
    canManageUsers: false,
    canEditTopology: true,
    canImportConfig: true,
    canAcknowledgeAlerts: true,
    canModifySettings: true,
    canRebootDevices: true,
  },
  Viewer: {
    canEditDevices: false,
    canManageUsers: false,
    canEditTopology: false,
    canImportConfig: false,
    canAcknowledgeAlerts: false,
    canModifySettings: false,
    canRebootDevices: false,
  },
};

export const isRole = (value: unknown): value is Role =>
  value === 'Admin' || value === 'Engineer' || value === 'Viewer';
