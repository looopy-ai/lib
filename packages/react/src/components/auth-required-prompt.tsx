import { type FC, useId, useState } from 'react';
import type { AuthRequiredTurn, AuthType } from '../conversation/types';

// ─── Sub-components for each auth type ───────────────────────────────────────

type ApiKeyCredential = { type: 'api-key'; key: string };
type PatCredential = { type: 'pat'; token: string };
type PasswordCredential = { type: 'password'; username: string; password: string };
type OAuth2Credential = { type: 'oauth2'; authorizationCode: string; state?: string };
type CustomCredential = { type: 'custom'; value: string };
export type AuthCredential =
  | ApiKeyCredential
  | PatCredential
  | PasswordCredential
  | OAuth2Credential
  | CustomCredential;

// ─────────────────────────────────────────────────────────────────────────────

const InfoLink: FC<{ url: string; label: string }> = ({ url, label }) => (
  <a
    href={url}
    target="_blank"
    rel="noreferrer"
    className="text-xs text-indigo-600 hover:underline"
  >
    {label} ↗
  </a>
);

const SubmitButton: FC<{ disabled: boolean; label?: string }> = ({
  disabled,
  label = 'Submit',
}) => (
  <button
    type="submit"
    disabled={disabled}
    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
  >
    {label}
  </button>
);

// ─── OAuth2 ───────────────────────────────────────────────────────────────────

const OAuth2Auth: FC<{
  authorizationEndpoint?: string;
  clientId?: string;
  codeChallenge?: string;
  codeChallengeMethod?: 'S256';
  onSubmit: (credential: OAuth2Credential) => void;
}> = ({ authorizationEndpoint, onSubmit }) => {
  const [code, setCode] = useState('');
  const codeId = useId();

  const handleOpen = () => {
    if (authorizationEndpoint) {
      window.open(authorizationEndpoint, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <form
      className="mt-3 flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (code.trim()) onSubmit({ type: 'oauth2', authorizationCode: code });
      }}
    >
      {authorizationEndpoint && (
        <button
          type="button"
          onClick={handleOpen}
          className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          Authorize ↗
        </button>
      )}
      <div>
        <label htmlFor={codeId} className="block text-xs font-medium text-slate-600 mb-1">
          Authorization code (paste after redirect)
        </label>
        <div className="flex gap-2">
          <input
            id={codeId}
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="flex-1 px-3 py-2 border border-slate-200 rounded-md bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="Paste authorization code…"
          />
          <SubmitButton disabled={!code.trim()} label="Submit" />
        </div>
      </div>
    </form>
  );
};

// ─── API Key ──────────────────────────────────────────────────────────────────

const ApiKeyAuth: FC<{
  infoUrl?: string;
  onSubmit: (credential: ApiKeyCredential) => void;
}> = ({ infoUrl, onSubmit }) => {
  const [key, setKey] = useState('');
  const id = useId();
  return (
    <form
      className="mt-3 flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (key.trim()) onSubmit({ type: 'api-key', key });
      }}
    >
      <div>
        <label htmlFor={id} className="block text-xs font-medium text-slate-600 mb-1">
          API Key
        </label>
        <input
          id={id}
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          className="block w-full px-3 py-2 border border-slate-200 rounded-md bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          placeholder="Enter API key…"
          autoComplete="off"
        />
      </div>
      {infoUrl && <InfoLink url={infoUrl} label="Get API key" />}
      <div className="flex justify-end">
        <SubmitButton disabled={!key.trim()} />
      </div>
    </form>
  );
};

// ─── PAT ─────────────────────────────────────────────────────────────────────

const PatAuth: FC<{
  infoUrl?: string;
  onSubmit: (credential: PatCredential) => void;
}> = ({ infoUrl, onSubmit }) => {
  const [token, setToken] = useState('');
  const id = useId();
  return (
    <form
      className="mt-3 flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (token.trim()) onSubmit({ type: 'pat', token });
      }}
    >
      <div>
        <label htmlFor={id} className="block text-xs font-medium text-slate-600 mb-1">
          Personal Access Token
        </label>
        <input
          id={id}
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          className="block w-full px-3 py-2 border border-slate-200 rounded-md bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          placeholder="Enter personal access token…"
          autoComplete="off"
        />
      </div>
      {infoUrl && <InfoLink url={infoUrl} label="Generate token" />}
      <div className="flex justify-end">
        <SubmitButton disabled={!token.trim()} />
      </div>
    </form>
  );
};

// ─── Password ─────────────────────────────────────────────────────────────────

const PasswordAuth: FC<{
  onSubmit: (credential: PasswordCredential) => void;
}> = ({ onSubmit }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const usernameId = useId();
  const passwordId = useId();
  return (
    <form
      className="mt-3 flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (username.trim() && password) onSubmit({ type: 'password', username, password });
      }}
    >
      <div>
        <label htmlFor={usernameId} className="block text-xs font-medium text-slate-600 mb-1">
          Username
        </label>
        <input
          id={usernameId}
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="block w-full px-3 py-2 border border-slate-200 rounded-md bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          placeholder="Username"
          autoComplete="username"
        />
      </div>
      <div>
        <label htmlFor={passwordId} className="block text-xs font-medium text-slate-600 mb-1">
          Password
        </label>
        <input
          id={passwordId}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="block w-full px-3 py-2 border border-slate-200 rounded-md bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          placeholder="Password"
          autoComplete="current-password"
        />
      </div>
      <div className="flex justify-end">
        <SubmitButton disabled={!username.trim() || !password} />
      </div>
    </form>
  );
};

// ─── Custom ───────────────────────────────────────────────────────────────────

const CustomAuth: FC<{
  onSubmit: (credential: CustomCredential) => void;
}> = ({ onSubmit }) => {
  const [value, setValue] = useState('');
  const id = useId();
  return (
    <form
      className="mt-3 flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) onSubmit({ type: 'custom', value });
      }}
    >
      <div>
        <label htmlFor={id} className="block text-xs font-medium text-slate-600 mb-1">
          Credential
        </label>
        <input
          id={id}
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="block w-full px-3 py-2 border border-slate-200 rounded-md bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          placeholder="Enter credential…"
          autoComplete="off"
        />
      </div>
      <div className="flex justify-end">
        <SubmitButton disabled={!value.trim()} />
      </div>
    </form>
  );
};

// ─── Auth body dispatcher ─────────────────────────────────────────────────────

type AuthBodyProps = Pick<
  AuthRequiredTurn,
  | 'authType'
  | 'infoUrl'
  | 'authorizationEndpoint'
  | 'clientId'
  | 'codeChallenge'
  | 'codeChallengeMethod'
> & { onSubmit: (credential: AuthCredential) => void };

const AuthBody: FC<AuthBodyProps> = ({
  authType,
  infoUrl,
  authorizationEndpoint,
  clientId,
  codeChallenge,
  codeChallengeMethod,
  onSubmit,
}) => {
  switch (authType as AuthType) {
    case 'oauth2':
      return (
        <OAuth2Auth
          authorizationEndpoint={authorizationEndpoint}
          clientId={clientId}
          codeChallenge={codeChallenge}
          codeChallengeMethod={codeChallengeMethod}
          onSubmit={onSubmit}
        />
      );
    case 'api-key':
      return <ApiKeyAuth infoUrl={infoUrl} onSubmit={onSubmit} />;
    case 'pat':
      return <PatAuth infoUrl={infoUrl} onSubmit={onSubmit} />;
    case 'password':
      return <PasswordAuth onSubmit={onSubmit} />;
    case 'custom':
      return <CustomAuth onSubmit={onSubmit} />;
  }
};

// ─── Public component ─────────────────────────────────────────────────────────

export type AuthRequiredPromptProps = {
  turn: AuthRequiredTurn;
  /**
   * Called when the user provides credentials.
   * The credential value is in plaintext — the caller is responsible
   * for encrypting it using `turn.encryptionKey` before sending to the agent.
   */
  onSubmit: (authId: string, credential: AuthCredential) => void;
  className?: string;
};

/**
 * Renders an agent auth-required request as an interactive prompt.
 * Supports oauth2, api-key, pat, password, and custom auth types.
 * Transitions to a readonly "completed" state once authentication is done.
 */
export const AuthRequiredPrompt: FC<AuthRequiredPromptProps> = ({ turn, onSubmit, className }) => {
  const statusMessage =
    turn.status === 'completed'
      ? '✓ Authentication completed'
      : turn.status === 'cancelled'
        ? '✕ Authentication cancelled'
        : null;

  const handleSubmit = (credential: AuthCredential) => {
    onSubmit(turn.authId, credential);
  };

  return (
    <section
      className={`rounded-md border border-blue-200 bg-blue-50 p-4 shadow-sm ${className ?? ''}`}
      aria-label="Authentication required"
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 text-blue-600" aria-hidden="true">
          🔐
        </span>
        <div className="flex-1">
          {turn.provider && (
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-600 mb-1">
              {turn.provider}
            </p>
          )}
          <p className="text-sm font-medium text-blue-900">{turn.prompt}</p>

          {turn.scopes && turn.scopes.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {turn.scopes.map((scope) => (
                <span
                  key={scope}
                  className="inline-block px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs font-mono"
                >
                  {scope}
                </span>
              ))}
            </div>
          )}

          {statusMessage ? (
            <p className="mt-2 text-xs text-slate-500 italic">{statusMessage}</p>
          ) : (
            <AuthBody
              authType={turn.authType}
              infoUrl={turn.infoUrl}
              authorizationEndpoint={turn.authorizationEndpoint}
              clientId={turn.clientId}
              codeChallenge={turn.codeChallenge}
              codeChallengeMethod={turn.codeChallengeMethod}
              onSubmit={handleSubmit}
            />
          )}
        </div>
      </div>
    </section>
  );
};
