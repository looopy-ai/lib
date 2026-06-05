import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AuthEncryptionKey, AuthRequiredTurn } from '../conversation/types';
import { AuthRequiredPrompt } from './auth-required-prompt';

const mockEncryptionKey: AuthEncryptionKey = {
  kty: 'EC',
  crv: 'P-256',
  x: 'dGVzdA',
  y: 'dGVzdA',
  kid: 'key-1',
};

const baseTurn: AuthRequiredTurn = {
  source: 'auth-required',
  id: 'auth-1',
  authId: 'auth-1',
  authType: 'api-key',
  prompt: 'Please provide your API key.',
  encryptionKey: mockEncryptionKey,
  status: 'pending',
  timestamp: '2025-01-01T00:00:00.000Z',
};

describe('AuthRequiredPrompt', () => {
  it('renders the prompt text', () => {
    render(<AuthRequiredPrompt turn={baseTurn} onSubmit={vi.fn()} />);
    expect(screen.getByText('Please provide your API key.')).toBeInTheDocument();
  });

  it('renders provider name when provided', () => {
    render(<AuthRequiredPrompt turn={{ ...baseTurn, provider: 'stripe' }} onSubmit={vi.fn()} />);
    expect(screen.getByText('stripe')).toBeInTheDocument();
  });

  it('renders scopes as badges when provided', () => {
    render(
      <AuthRequiredPrompt
        turn={{ ...baseTurn, scopes: ['read:user', 'repo'] }}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByText('read:user')).toBeInTheDocument();
    expect(screen.getByText('repo')).toBeInTheDocument();
  });

  describe('api-key type', () => {
    it('renders a password input for the API key', () => {
      render(<AuthRequiredPrompt turn={baseTurn} onSubmit={vi.fn()} />);
      expect(screen.getByLabelText('API Key')).toBeInTheDocument();
    });

    it('calls onSubmit with api-key credential on form submit', async () => {
      const onSubmit = vi.fn();
      render(<AuthRequiredPrompt turn={baseTurn} onSubmit={onSubmit} />);
      await userEvent.type(screen.getByLabelText('API Key'), 'sk-abc123');
      await userEvent.click(screen.getByRole('button', { name: 'Submit' }));
      expect(onSubmit).toHaveBeenCalledWith('auth-1', { type: 'api-key', key: 'sk-abc123' });
    });

    it('renders info URL link when provided', () => {
      render(
        <AuthRequiredPrompt
          turn={{ ...baseTurn, infoUrl: 'https://example.com/apikeys' }}
          onSubmit={vi.fn()}
        />,
      );
      expect(screen.getByRole('link', { name: /get api key/i })).toHaveAttribute(
        'href',
        'https://example.com/apikeys',
      );
    });

    it('disables submit when input is empty', () => {
      render(<AuthRequiredPrompt turn={baseTurn} onSubmit={vi.fn()} />);
      expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
    });
  });

  describe('pat type', () => {
    const patTurn: AuthRequiredTurn = { ...baseTurn, authType: 'pat', prompt: 'Enter PAT' };

    it('renders a password input for the token', () => {
      render(<AuthRequiredPrompt turn={patTurn} onSubmit={vi.fn()} />);
      expect(screen.getByLabelText('Personal Access Token')).toBeInTheDocument();
    });

    it('calls onSubmit with pat credential', async () => {
      const onSubmit = vi.fn();
      render(<AuthRequiredPrompt turn={patTurn} onSubmit={onSubmit} />);
      await userEvent.type(screen.getByLabelText('Personal Access Token'), 'glpat-abc');
      await userEvent.click(screen.getByRole('button', { name: 'Submit' }));
      expect(onSubmit).toHaveBeenCalledWith('auth-1', { type: 'pat', token: 'glpat-abc' });
    });
  });

  describe('password type', () => {
    const passwordTurn: AuthRequiredTurn = {
      ...baseTurn,
      authType: 'password',
      prompt: 'Sign in',
    };

    it('renders username and password inputs', () => {
      render(<AuthRequiredPrompt turn={passwordTurn} onSubmit={vi.fn()} />);
      expect(screen.getByLabelText('Username')).toBeInTheDocument();
      expect(screen.getByLabelText('Password')).toBeInTheDocument();
    });

    it('calls onSubmit with password credential', async () => {
      const onSubmit = vi.fn();
      render(<AuthRequiredPrompt turn={passwordTurn} onSubmit={onSubmit} />);
      await userEvent.type(screen.getByLabelText('Username'), 'alice');
      await userEvent.type(screen.getByLabelText('Password'), 'secret');
      await userEvent.click(screen.getByRole('button', { name: 'Submit' }));
      expect(onSubmit).toHaveBeenCalledWith('auth-1', {
        type: 'password',
        username: 'alice',
        password: 'secret',
      });
    });

    it('disables submit when username is empty', () => {
      render(<AuthRequiredPrompt turn={passwordTurn} onSubmit={vi.fn()} />);
      expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
    });
  });

  describe('oauth2 type', () => {
    const oauth2Turn: AuthRequiredTurn = {
      ...baseTurn,
      authType: 'oauth2',
      authorizationEndpoint: 'https://example.com/auth',
      clientId: 'client-1',
      codeChallenge: 'abc',
      codeChallengeMethod: 'S256',
      prompt: 'Authorize access',
    };

    it('renders an Authorize button', () => {
      render(<AuthRequiredPrompt turn={oauth2Turn} onSubmit={vi.fn()} />);
      expect(screen.getByRole('button', { name: /authorize/i })).toBeInTheDocument();
    });

    it('renders a code input field', () => {
      render(<AuthRequiredPrompt turn={oauth2Turn} onSubmit={vi.fn()} />);
      expect(screen.getByPlaceholderText(/authorization code/i)).toBeInTheDocument();
    });
  });

  describe('custom type', () => {
    const customTurn: AuthRequiredTurn = {
      ...baseTurn,
      authType: 'custom',
      prompt: 'Enter credential',
    };

    it('renders a credential input', () => {
      render(<AuthRequiredPrompt turn={customTurn} onSubmit={vi.fn()} />);
      expect(screen.getByLabelText('Credential')).toBeInTheDocument();
    });

    it('calls onSubmit with custom credential', async () => {
      const onSubmit = vi.fn();
      render(<AuthRequiredPrompt turn={customTurn} onSubmit={onSubmit} />);
      await userEvent.type(screen.getByLabelText('Credential'), 'my-cred');
      await userEvent.click(screen.getByRole('button', { name: 'Submit' }));
      expect(onSubmit).toHaveBeenCalledWith('auth-1', { type: 'custom', value: 'my-cred' });
    });
  });

  describe('completed status', () => {
    it('shows completed message instead of input controls', () => {
      render(<AuthRequiredPrompt turn={{ ...baseTurn, status: 'completed' }} onSubmit={vi.fn()} />);
      expect(screen.getByText(/authentication completed/i)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Submit' })).not.toBeInTheDocument();
    });

    it('shows cancelled message instead of input controls', () => {
      render(<AuthRequiredPrompt turn={{ ...baseTurn, status: 'cancelled' }} onSubmit={vi.fn()} />);
      expect(screen.getByText(/authentication cancelled/i)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Submit' })).not.toBeInTheDocument();
    });
  });
});
