import type { Device } from '@prisma/client';
import type { SnmpTarget } from './client.js';
import { env } from '../env.js';

/** Overrides used by the "Test SNMP" button, which probes credentials before saving them. */
export interface TargetOverrides {
  ip?: string;
  snmpVersion?: string | null;
  snmpPort?: number | null;
  snmpCommunity?: string | null;
  snmpV3User?: string | null;
  snmpV3SecurityLevel?: string | null;
  snmpV3AuthProtocol?: string | null;
  snmpV3AuthKey?: string | null;
  snmpV3PrivProtocol?: string | null;
  snmpV3PrivKey?: string | null;
  snmpV3Context?: string | null;
  timeoutMs?: number;
}

type DeviceLike = Pick<
  Device,
  | 'ip'
  | 'snmpVersion'
  | 'snmpPort'
  | 'snmpCommunity'
  | 'snmpV3User'
  | 'snmpV3SecurityLevel'
  | 'snmpV3AuthProtocol'
  | 'snmpV3AuthKey'
  | 'snmpV3PrivProtocol'
  | 'snmpV3PrivKey'
  | 'snmpV3Context'
>;

/**
 * Build the SNMP transport parameters for a device.
 *
 * `timeoutMs` comes from the Ping Timeout field on the Settings page, so changing it
 * there changes how long a poll waits before the device counts as unreachable.
 */
export const targetFromDevice = (device: DeviceLike, overrides: TargetOverrides = {}): SnmpTarget => {
  const version = (overrides.snmpVersion ?? device.snmpVersion) === '3' ? '3' : '2c';
  return {
    host: overrides.ip ?? device.ip,
    port: overrides.snmpPort ?? device.snmpPort ?? 161,
    version,
    community: overrides.snmpCommunity ?? device.snmpCommunity ?? 'public',
    timeoutMs: overrides.timeoutMs ?? env.snmp.timeoutMs,
    retries: env.snmp.retries,
    ...(version === '3'
      ? {
          v3: {
            user: overrides.snmpV3User ?? device.snmpV3User ?? '',
            securityLevel: (overrides.snmpV3SecurityLevel ??
              device.snmpV3SecurityLevel ??
              'authPriv') as 'noAuthNoPriv' | 'authNoPriv' | 'authPriv',
            authProtocol: (overrides.snmpV3AuthProtocol ?? device.snmpV3AuthProtocol ?? 'sha') as
              | 'md5'
              | 'sha'
              | 'sha224'
              | 'sha256'
              | 'sha384'
              | 'sha512',
            authKey: overrides.snmpV3AuthKey ?? device.snmpV3AuthKey ?? '',
            privProtocol: (overrides.snmpV3PrivProtocol ?? device.snmpV3PrivProtocol ?? 'aes') as
              | 'des'
              | 'aes'
              | 'aes256b'
              | 'aes256r',
            privKey: overrides.snmpV3PrivKey ?? device.snmpV3PrivKey ?? '',
            context: overrides.snmpV3Context ?? device.snmpV3Context ?? undefined,
          },
        }
      : {}),
  };
};
