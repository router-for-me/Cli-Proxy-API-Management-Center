import { apiClient } from './client';

export interface ManagedLimits {
  requests_per_minute: number;
  concurrent_requests: number;
  monthly_tokens: number;
  allowed_models: string[];
}

export interface ManagedUser {
  id: string;
  name: string;
  email?: string;
  status: 'active' | 'disabled';
  limits: ManagedLimits;
  expires_at?: string;
  created_at: string;
  updated_at: string;
}

export interface ManagedApiKey {
  id: string;
  user_id: string;
  name: string;
  prefix: string;
  status: 'active' | 'revoked';
  expires_at?: string;
  last_used_at?: string;
  created_at: string;
}

export interface CreatedManagedApiKey extends ManagedApiKey {
  secret: string;
}

export interface ManagedUsage {
  user_id: string;
  period_start: string;
  requests: number;
  failed: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

export interface ManagedUserDetails {
  user: ManagedUser;
  api_keys: ManagedApiKey[];
  usage: ManagedUsage;
}

export interface OAuthInvitation {
  id: string;
  label: string;
  providers: string[];
  max_uses: number;
  used_uses: number;
  reserved_uses: number;
  active: boolean;
  expires_at?: string;
  created_at: string;
}

export interface CreatedOAuthInvitation extends OAuthInvitation {
  token: string;
  url: string;
}

export type ManagedUserPayload = Pick<ManagedUser, 'name' | 'email' | 'status' | 'limits'> & {
  expires_at?: string | null;
};

export const accessControlApi = {
  async listUsers(): Promise<ManagedUser[]> {
    const response = await apiClient.get<{ users: ManagedUser[] }>('/users');
    return response.users ?? [];
  },
  getUser(id: string): Promise<ManagedUserDetails> {
    return apiClient.get(`/users/${encodeURIComponent(id)}`);
  },
  createUser(payload: ManagedUserPayload): Promise<ManagedUser> {
    return apiClient.post('/users', payload);
  },
  updateUser(id: string, payload: ManagedUserPayload): Promise<ManagedUser> {
    return apiClient.patch(`/users/${encodeURIComponent(id)}`, payload);
  },
  deleteUser(id: string): Promise<void> {
    return apiClient.delete(`/users/${encodeURIComponent(id)}`);
  },
  createApiKey(userId: string, name: string): Promise<CreatedManagedApiKey> {
    return apiClient.post(`/users/${encodeURIComponent(userId)}/api-keys`, { name });
  },
  revokeApiKey(id: string): Promise<void> {
    return apiClient.delete(`/managed-api-keys/${encodeURIComponent(id)}`);
  },
  async listInvitations(): Promise<OAuthInvitation[]> {
    const response = await apiClient.get<{ invitations: OAuthInvitation[] }>('/oauth-invites');
    return response.invitations ?? [];
  },
  createInvitation(payload: {
    label: string;
    providers: string[];
    max_uses: number;
    expires_at?: string | null;
  }): Promise<CreatedOAuthInvitation> {
    return apiClient.post('/oauth-invites', payload);
  },
  revokeInvitation(id: string): Promise<void> {
    return apiClient.delete(`/oauth-invites/${encodeURIComponent(id)}`);
  },
};
