/**
 * The only place the frontend talks to the collector.
 *
 * Base URL: `VITE_API_URL` if set, otherwise `/api`, which the Vite dev server
 * proxies to http://localhost:4000 (see vite.config.ts). In production, serve the
 * built frontend behind the same origin as the API and `/api` keeps working.
 */
import type {
  AccessPoint,
  ClientSession,
  ConfigBackup,
  DeviceType,
  IncidentAlert,
  NetworkDevice,
  PortInfo,
  Role,
  SnmpProbeResult,
  SystemSettings,
  SyslogEntry,
  TelemetryHistory,
  TelemetryStatus,
  TopPortRow,
  TopologyLink,
  TopologyNode,
  User,
  UserPermissions,
  VlanInfo,
} from '../types';

const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || '/api';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string = 'ERROR',
    readonly details?: Array<{ field: string; message: string }>
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** True when the session is gone and the user has to sign in again. */
  get isAuthFailure(): boolean {
    return this.status === 401;
  }
}

// ---------------------------------------------------------------- token

let authToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export const setAuthToken = (token: string | null): void => {
  authToken = token;
};

export const getAuthToken = (): string | null => authToken;

/** AuthContext registers a callback here so an expired token logs the user out once. */
export const setUnauthorizedHandler = (handler: (() => void) | null): void => {
  onUnauthorized = handler;
};

// ---------------------------------------------------------------- request

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Skip the global logout on 401 — used by the login call itself. */
  allowUnauthorized?: boolean;
  signal?: AbortSignal;
}

const request = async <T>(path: string, options: RequestOptions = {}): Promise<T> => {
  const { method = 'GET', body, allowUnauthorized, signal } = options;

  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    // fetch only rejects when the request never reached the server
    throw new ApiError(
      0,
      'Cannot reach the NetMonitor collector. Check that the server is running and that VITE_API_URL is correct.',
      'NETWORK'
    );
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { error: text };
    }
  }

  if (!response.ok) {
    const data = (payload ?? {}) as { error?: string; code?: string; details?: Array<{ field: string; message: string }> };
    if (response.status === 401 && !allowUnauthorized) onUnauthorized?.();
    throw new ApiError(
      response.status,
      data.error || `Request failed with status ${response.status}`,
      data.code || 'ERROR',
      data.details
    );
  }

  return payload as T;
};

// ---------------------------------------------------------------- payload shapes

export interface LoginResponse {
  token: string;
  user: User;
}

export interface RegisterResponse extends LoginResponse {
  assignedRole: Role;
}

export interface ForgotPasswordResponse {
  success: true;
  otp: string;
  expiresAt: number;
  deliveredBy: 'response';
}

export interface BootstrapResponse {
  serverTime: string;
  devices: NetworkDevice[];
  portsByDevice: Record<string, PortInfo[]>;
  vlans: VlanInfo[];
  accessPoints: AccessPoint[];
  clients: ClientSession[];
  topologyNodes: TopologyNode[];
  topologyLinks: TopologyLink[];
  alerts: IncidentAlert[];
  syslogs: SyslogEntry[];
  backups: ConfigBackup[];
  settings: SystemSettings;
}

export interface PollCycleSummary {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  polled: number;
  reachable: number;
  failed: number;
  skipped: number;
  devices: Array<{ id: string; name: string; ip: string; ok: boolean; error?: string; responseMs: number }>;
}

/** Fields accepted when registering or editing a device. */
export interface DeviceInput {
  name: string;
  ip: string;
  type: DeviceType;
  mac?: string;
  vendor?: string;
  model?: string;
  location?: string;
  rack?: string;
  firmware?: string;
  config?: string;
  pollEnabled?: boolean;
  snmpVersion?: '2c' | '3';
  snmpPort?: number;
  snmpCommunity?: string;
  snmpWriteCommunity?: string;
  snmpV3User?: string;
  snmpV3SecurityLevel?: 'noAuthNoPriv' | 'authNoPriv' | 'authPriv';
  snmpV3AuthProtocol?: 'md5' | 'sha' | 'sha224' | 'sha256' | 'sha384' | 'sha512';
  snmpV3AuthKey?: string;
  snmpV3PrivProtocol?: 'des' | 'aes' | 'aes256b' | 'aes256r';
  snmpV3PrivKey?: string;
  snmpV3Context?: string;
}

export type SnmpCredentials = Pick<
  DeviceInput,
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

export interface TopologyPlacement {
  parentNodeId: string | null;
  linkType: TopologyLink['linkType'];
  addNode?: boolean;
}

// ---------------------------------------------------------------- endpoints

export const api = {
  health: () => request<{ status: string; serverTime: string; pollerEnabled: boolean }>('/health'),

  bootstrap: (signal?: AbortSignal) => request<BootstrapResponse>('/bootstrap', { signal }),

  auth: {
    login: (identifier: string, password: string) =>
      request<LoginResponse>('/auth/login', {
        method: 'POST',
        body: { identifier, password },
        allowUnauthorized: true,
      }),

    register: (name: string, email: string, password: string, department?: string) =>
      request<RegisterResponse>('/auth/register', {
        method: 'POST',
        body: { name, email, password, department },
        allowUnauthorized: true,
      }),

    me: () => request<{ user: User }>('/auth/me', { allowUnauthorized: true }),

    changePassword: (currentPassword: string, newPassword: string) =>
      request<{ success: true }>('/auth/change-password', {
        method: 'POST',
        body: { currentPassword, newPassword },
      }),

    forgotPassword: (email: string) =>
      request<ForgotPasswordResponse>('/auth/forgot-password', {
        method: 'POST',
        body: { email },
        allowUnauthorized: true,
      }),

    resetPassword: (email: string, otp: string, newPassword: string) =>
      request<{ success: true }>('/auth/reset-password', {
        method: 'POST',
        body: { email, otp, newPassword },
        allowUnauthorized: true,
      }),
  },

  users: {
    list: () => request<User[]>('/users'),
    create: (input: {
      name: string;
      email: string;
      password: string;
      role: Role;
      department?: string;
      status?: 'Active' | 'Suspended';
      permissions?: Partial<UserPermissions>;
    }) => request<User>('/users', { method: 'POST', body: input }),
    update: (
      id: string,
      input: {
        role?: Role;
        status?: 'Active' | 'Suspended';
        department?: string;
        name?: string;
        password?: string;
        permissions?: Partial<UserPermissions>;
      }
    ) => request<User>(`/users/${id}`, { method: 'PATCH', body: input }),
    remove: (id: string) => request<{ success: true }>(`/users/${id}`, { method: 'DELETE' }),
  },

  devices: {
    list: () => request<NetworkDevice[]>('/devices'),
    get: (id: string) => request<NetworkDevice>(`/devices/${id}`),
    create: (input: DeviceInput & { topology?: TopologyPlacement }) =>
      request<NetworkDevice>('/devices', { method: 'POST', body: input }),
    update: (id: string, input: Partial<DeviceInput>) =>
      request<NetworkDevice>(`/devices/${id}`, { method: 'PATCH', body: input }),
    remove: (id: string) => request<{ success: true }>(`/devices/${id}`, { method: 'DELETE' }),
    /** Probe an address with the given credentials before saving them. */
    testSnmp: (input: SnmpCredentials & { ip: string; withPorts?: boolean }) =>
      request<SnmpProbeResult>('/devices/test-snmp', { method: 'POST', body: input }),
    poll: (id: string) =>
      request<{ summary: PollCycleSummary; device: NetworkDevice | null }>(`/devices/${id}/poll`, {
        method: 'POST',
      }),
  },

  ports: {
    all: () => request<Record<string, PortInfo[]>>('/ports'),
    forDevice: (deviceId: string) => request<PortInfo[]>(`/ports/${deviceId}`),
    /** Writes ifAdminStatus on the real device. Needs a write credential. */
    setAdmin: (deviceId: string, portId: number, adminUp: boolean) =>
      request<PortInfo>(`/ports/${deviceId}/${portId}/admin`, { method: 'POST', body: { adminUp } }),
  },

  vlans: {
    list: () => request<VlanInfo[]>('/vlans'),
    create: (input: {
      id: number;
      name: string;
      subnet?: string;
      gateway?: string;
      dhcpTotal?: number;
      dhcpUsed?: number;
      description?: string;
    }) => request<VlanInfo>('/vlans', { method: 'POST', body: input }),
    update: (id: number, input: Partial<Omit<VlanInfo, 'id' | 'activePorts' | 'trafficRateMbps'>>) =>
      request<VlanInfo>(`/vlans/${id}`, { method: 'PATCH', body: input }),
    remove: (id: number) => request<{ success: true }>(`/vlans/${id}`, { method: 'DELETE' }),
  },

  topology: {
    get: () => request<{ nodes: TopologyNode[]; links: TopologyLink[] }>('/topology'),
    addNode: (input: Omit<TopologyNode, 'id'>) =>
      request<TopologyNode>('/topology/nodes', { method: 'POST', body: input }),
    updateNode: (
      id: string,
      input: Partial<Pick<TopologyNode, 'label' | 'x' | 'y' | 'isCollapsed' | 'tier' | 'type'>>
    ) => request<TopologyNode>(`/topology/nodes/${id}`, { method: 'PATCH', body: input }),
    removeNode: (id: string) => request<{ success: true }>(`/topology/nodes/${id}`, { method: 'DELETE' }),
    saveLayout: (nodes: Array<{ id: string; x: number; y: number; isCollapsed?: boolean }>) =>
      request<{ nodes: TopologyNode[] }>('/topology/layout', { method: 'PUT', body: { nodes } }),
    addLink: (source: string, target: string, linkType: TopologyLink['linkType']) =>
      request<TopologyLink>('/topology/links', { method: 'POST', body: { source, target, linkType } }),
    updateLink: (id: string, linkType: TopologyLink['linkType']) =>
      request<TopologyLink>(`/topology/links/${id}`, { method: 'PATCH', body: { linkType } }),
    removeLink: (id: string) => request<{ success: true }>(`/topology/links/${id}`, { method: 'DELETE' }),
  },

  alerts: {
    list: () => request<IncidentAlert[]>('/alerts'),
    acknowledge: (id: string, note: string) =>
      request<IncidentAlert>(`/alerts/${id}/acknowledge`, { method: 'POST', body: { note } }),
    resolve: (id: string, note?: string) =>
      request<IncidentAlert>(`/alerts/${id}/resolve`, { method: 'POST', body: { note } }),
    addNote: (id: string, note: string) =>
      request<IncidentAlert>(`/alerts/${id}/notes`, { method: 'POST', body: { note } }),
  },

  syslogs: {
    list: (params: { limit?: number; severity?: string; host?: string; q?: string } = {}) => {
      const query = new URLSearchParams();
      if (params.limit) query.set('limit', String(params.limit));
      if (params.severity) query.set('severity', params.severity);
      if (params.host) query.set('host', params.host);
      if (params.q) query.set('q', params.q);
      const suffix = query.toString();
      return request<SyslogEntry[]>(`/syslogs${suffix ? `?${suffix}` : ''}`);
    },
  },

  backups: {
    list: () => request<ConfigBackup[]>('/backups'),
    create: (input: {
      deviceId: string;
      versionTag: string;
      triggerType?: 'manual' | 'scheduled' | 'pre-change';
      notes?: string;
      configContent?: string;
    }) => request<ConfigBackup>('/backups', { method: 'POST', body: input }),
    restore: (id: string) =>
      request<{ success: true; appliedToDevice: boolean; message: string }>(`/backups/${id}/restore`, {
        method: 'POST',
      }),
    remove: (id: string) => request<{ success: true }>(`/backups/${id}`, { method: 'DELETE' }),
  },

  settings: {
    get: () => request<SystemSettings>('/settings'),
    /**
     * Really sends a Telegram message and reports what Telegram said. Answers 200
     * even when Telegram refuses, with `ok: false` and the reason.
     */
    testTelegram: (input: { telegramBotToken?: string; telegramChatId?: string } = {}) =>
      request<{ ok: boolean; error?: string; hint?: string }>('/settings/test-telegram', {
        method: 'POST',
        body: input,
      }),

    /** Really sends an email through SMTP and reports what the mail server said. */
    testEmail: (
      input: {
        smtpHost?: string;
        smtpPort?: number;
        smtpUser?: string;
        smtpPassword?: string;
        emailFrom?: string;
        emailNotification?: string;
      } = {}
    ) =>
      request<{ ok: boolean; error?: string; hint?: string }>('/settings/test-email', {
        method: 'POST',
        body: input,
      }),
    update: (
      input: Partial<Omit<SystemSettings, 'backupPolicy'>> & { lastGlobalBackup?: string }
    ) => request<SystemSettings>('/settings', { method: 'PATCH', body: input }),
  },

  telemetry: {
    refresh: () => request<PollCycleSummary>('/telemetry/refresh', { method: 'POST' }),
    status: () => request<TelemetryStatus>('/telemetry/status'),
    history: (params: { hours?: number; points?: number; deviceId?: string } = {}) => {
      const query = new URLSearchParams();
      if (params.hours) query.set('hours', String(params.hours));
      if (params.points) query.set('points', String(params.points));
      if (params.deviceId) query.set('deviceId', params.deviceId);
      const suffix = query.toString();
      return request<TelemetryHistory>(`/telemetry/history${suffix ? `?${suffix}` : ''}`);
    },
    topPorts: (limit = 5) => request<TopPortRow[]>(`/telemetry/top-ports?limit=${limit}`),
  },

  wireless: {
    accessPoints: () => request<AccessPoint[]>('/wireless/access-points'),
    clients: () => request<ClientSession[]>('/wireless/clients'),
    reboot: (id: string) =>
      request<{ success: true }>(`/wireless/access-points/${id}/reboot`, { method: 'POST' }),
  },
};

// ---------------------------------------------------------------- server-sent events

export type StreamEvent =
  | { type: 'hello'; at: string; user?: string }
  | { type: 'telemetry'; at: string; polled: number; reachable: number; failed: number }
  | { type: 'alert'; at: string; alertId: string; severity: string; deviceName: string; message: string }
  | { type: 'device'; at: string; deviceId: string; action: 'created' | 'updated' | 'deleted' }
  | { type: 'syslog'; at: string; host: string; severity: string; message: string }
  | { type: 'settings'; at: string };

/**
 * Subscribe to collector events so the UI updates the moment a poll finishes.
 *
 * EventSource cannot set an Authorization header, so the token rides in the query
 * string — the same token already in browser storage, over the same origin.
 * Returns an unsubscribe function. The browser reconnects on its own if the
 * connection drops, so the UI keeps its interval refresh as a safety net.
 */
export const subscribeToEvents = (
  token: string,
  onEvent: (event: StreamEvent) => void,
  onError?: () => void
): (() => void) => {
  const source = new EventSource(`${BASE}/stream?token=${encodeURIComponent(token)}`);

  source.onmessage = message => {
    try {
      onEvent(JSON.parse(message.data) as StreamEvent);
    } catch {
      // ignore a malformed frame rather than tearing down the stream
    }
  };
  source.onerror = () => onError?.();

  return () => source.close();
};
