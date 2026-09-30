export type JsonRecord = Record<string, unknown>;

export interface BackendUser {
  id: string;
  email?: string;
  user_metadata?: JsonRecord;
}

export interface AuthContext {
  user: BackendUser;
  profile: JsonRecord;
}

export type AuthResult = AuthContext | { error: Response };
