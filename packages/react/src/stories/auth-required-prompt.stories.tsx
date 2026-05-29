import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { AuthRequiredPrompt } from '../components/auth-required-prompt';
import type { AuthRequiredTurn } from '../conversation/types';

const mockEncryptionKey = {
  kty: 'EC',
  crv: 'P-256',
  x: 'dGhpcyBpcyBhIHRlc3Qga2V5',
  y: 'dGhpcyBpcyBhIHRlc3Qga2V5',
  kid: 'key-1',
  alg: 'ECDH-ES',
};

const baseTurn: Omit<AuthRequiredTurn, 'authType'> = {
  source: 'auth-required',
  id: 'auth-1',
  authId: 'auth-1',
  prompt: 'Authentication is required to continue.',
  encryptionKey: mockEncryptionKey,
  status: 'pending',
  timestamp: new Date().toISOString(),
};

const meta = {
  title: 'Components/AuthRequiredPrompt',
  component: AuthRequiredPrompt,
  parameters: {
    layout: 'padded',
  },
  args: {
    onSubmit: (authId, credential) => {
      console.log('Auth submitted', { authId, credential });
    },
  },
} satisfies Meta<typeof AuthRequiredPrompt>;

export default meta;
type Story = StoryObj<typeof meta>;

// ─── OAuth2 ───────────────────────────────────────────────────────────────────

export const OAuth2: Story = {
  args: {
    turn: {
      ...baseTurn,
      authType: 'oauth2',
      provider: 'github',
      scopes: ['repo', 'read:user'],
      prompt: 'Authorize GitHub access to read your repositories.',
      authorizationEndpoint: 'https://github.com/login/oauth/authorize?client_id=demo&scope=repo',
      clientId: 'demo-client',
      codeChallenge: 'abc123',
      codeChallengeMethod: 'S256',
    } satisfies AuthRequiredTurn,
  },
};

export const OAuth2Completed: Story = {
  name: 'OAuth2 (completed)',
  args: {
    turn: {
      ...baseTurn,
      authType: 'oauth2',
      provider: 'github',
      scopes: ['repo', 'read:user'],
      prompt: 'Authorize GitHub access to read your repositories.',
      authorizationEndpoint: 'https://github.com/login/oauth/authorize?client_id=demo&scope=repo',
      clientId: 'demo-client',
      codeChallenge: 'abc123',
      codeChallengeMethod: 'S256',
      status: 'completed',
    } satisfies AuthRequiredTurn,
  },
};

// ─── API Key ──────────────────────────────────────────────────────────────────

export const ApiKey: Story = {
  args: {
    turn: {
      ...baseTurn,
      id: 'auth-2',
      authId: 'auth-2',
      authType: 'api-key',
      provider: 'stripe',
      prompt: 'Please provide your Stripe API key to process payments.',
      infoUrl: 'https://dashboard.stripe.com/apikeys',
    } satisfies AuthRequiredTurn,
  },
};

export const ApiKeyCompleted: Story = {
  name: 'API Key (completed)',
  args: {
    turn: {
      ...baseTurn,
      id: 'auth-2',
      authId: 'auth-2',
      authType: 'api-key',
      provider: 'stripe',
      prompt: 'Please provide your Stripe API key to process payments.',
      infoUrl: 'https://dashboard.stripe.com/apikeys',
      status: 'completed',
    } satisfies AuthRequiredTurn,
  },
};

// ─── PAT ─────────────────────────────────────────────────────────────────────

export const PersonalAccessToken: Story = {
  name: 'Personal Access Token',
  args: {
    turn: {
      ...baseTurn,
      id: 'auth-3',
      authId: 'auth-3',
      authType: 'pat',
      provider: 'gitlab',
      scopes: ['api', 'read_repository'],
      prompt: 'A GitLab personal access token is required.',
      infoUrl: 'https://gitlab.com/-/user_settings/personal_access_tokens',
    } satisfies AuthRequiredTurn,
  },
};

// ─── Password ─────────────────────────────────────────────────────────────────

export const Password: Story = {
  args: {
    turn: {
      ...baseTurn,
      id: 'auth-4',
      authId: 'auth-4',
      authType: 'password',
      provider: 'internal',
      prompt: 'Sign in with your username and password to continue.',
    } satisfies AuthRequiredTurn,
  },
};

// ─── Custom ───────────────────────────────────────────────────────────────────

export const Custom: Story = {
  args: {
    turn: {
      ...baseTurn,
      id: 'auth-5',
      authId: 'auth-5',
      authType: 'custom',
      prompt: 'Enter your service credential to proceed.',
    } satisfies AuthRequiredTurn,
  },
};

// ─── No provider ─────────────────────────────────────────────────────────────

export const NoProvider: Story = {
  name: 'API Key (no provider/scopes)',
  args: {
    turn: {
      ...baseTurn,
      id: 'auth-6',
      authId: 'auth-6',
      authType: 'api-key',
      prompt: 'An API key is required to continue.',
    } satisfies AuthRequiredTurn,
  },
};

// ─── Interactive demo ─────────────────────────────────────────────────────────

export const Interactive: Story = {
  render: (args) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [turn, setTurn] = useState<AuthRequiredTurn>({
      ...baseTurn,
      authType: 'api-key',
      provider: 'openai',
      prompt: 'Submit to see this turn transition to completed state.',
      infoUrl: 'https://platform.openai.com/api-keys',
    });

    return (
      <AuthRequiredPrompt
        {...args}
        turn={turn}
        onSubmit={(authId, credential) => {
          console.log('Auth submitted', { authId, credential });
          setTurn((t) => ({ ...t, status: 'completed' }));
        }}
      />
    );
  },
  args: {
    turn: {
      ...baseTurn,
      authType: 'api-key',
    },
  },
};
