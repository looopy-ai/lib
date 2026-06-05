import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { InputRequiredTurn } from '../conversation/types';
import { InputRequiredPrompt } from './input-required-prompt';

const baseTurn: InputRequiredTurn = {
  source: 'input-required',
  id: 'input-1',
  inputId: 'input-1',
  prompt: 'Are you sure?',
  inputType: 'confirmation',
  status: 'pending',
  timestamp: '2025-01-01T00:00:00.000Z',
};

describe('InputRequiredPrompt', () => {
  it('renders the prompt text', () => {
    render(<InputRequiredPrompt turn={baseTurn} onSubmit={vi.fn()} />);
    expect(screen.getByText('Are you sure?')).toBeInTheDocument();
  });

  describe('confirmation type', () => {
    it('renders Yes and No buttons', () => {
      render(<InputRequiredPrompt turn={baseTurn} onSubmit={vi.fn()} />);
      expect(screen.getByRole('button', { name: 'Yes' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'No' })).toBeInTheDocument();
    });

    it('calls onSubmit with true when Yes is clicked', async () => {
      const onSubmit = vi.fn();
      render(<InputRequiredPrompt turn={baseTurn} onSubmit={onSubmit} />);
      await userEvent.click(screen.getByRole('button', { name: 'Yes' }));
      expect(onSubmit).toHaveBeenCalledWith('input-1', true);
    });

    it('calls onSubmit with false when No is clicked', async () => {
      const onSubmit = vi.fn();
      render(<InputRequiredPrompt turn={baseTurn} onSubmit={onSubmit} />);
      await userEvent.click(screen.getByRole('button', { name: 'No' }));
      expect(onSubmit).toHaveBeenCalledWith('input-1', false);
    });
  });

  describe('clarification type', () => {
    const clarificationTurn: InputRequiredTurn = {
      ...baseTurn,
      inputType: 'clarification',
      prompt: 'What region?',
    };

    it('renders a textarea', () => {
      render(<InputRequiredPrompt turn={clarificationTurn} onSubmit={vi.fn()} />);
      expect(screen.getByRole('textbox')).toBeInTheDocument();
    });

    it('calls onSubmit with the entered text', async () => {
      const onSubmit = vi.fn();
      render(<InputRequiredPrompt turn={clarificationTurn} onSubmit={onSubmit} />);
      await userEvent.type(screen.getByRole('textbox'), 'us-east-1');
      await userEvent.click(screen.getByRole('button', { name: 'Submit' }));
      expect(onSubmit).toHaveBeenCalledWith('input-1', 'us-east-1');
    });

    it('disables submit when textarea is empty', () => {
      render(<InputRequiredPrompt turn={clarificationTurn} onSubmit={vi.fn()} />);
      expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
    });
  });

  describe('selection type', () => {
    const selectionTurn: InputRequiredTurn = {
      ...baseTurn,
      inputType: 'selection',
      prompt: 'Choose environment',
      options: ['dev', 'staging', 'prod'],
    };

    it('renders radio buttons for each option', () => {
      render(<InputRequiredPrompt turn={selectionTurn} onSubmit={vi.fn()} />);
      expect(screen.getByLabelText('dev')).toBeInTheDocument();
      expect(screen.getByLabelText('staging')).toBeInTheDocument();
      expect(screen.getByLabelText('prod')).toBeInTheDocument();
    });

    it('calls onSubmit with selected option', async () => {
      const onSubmit = vi.fn();
      render(<InputRequiredPrompt turn={selectionTurn} onSubmit={onSubmit} />);
      await userEvent.click(screen.getByLabelText('staging'));
      await userEvent.click(screen.getByRole('button', { name: 'Submit' }));
      expect(onSubmit).toHaveBeenCalledWith('input-1', 'staging');
    });

    it('disables submit when nothing is selected', () => {
      render(<InputRequiredPrompt turn={selectionTurn} onSubmit={vi.fn()} />);
      expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
    });
  });

  describe('data type', () => {
    const dataTurn: InputRequiredTurn = { ...baseTurn, inputType: 'data', prompt: 'Enter value' };

    it('renders a text input', () => {
      render(<InputRequiredPrompt turn={dataTurn} onSubmit={vi.fn()} />);
      expect(screen.getByRole('textbox')).toBeInTheDocument();
    });

    it('calls onSubmit with the entered value', async () => {
      const onSubmit = vi.fn();
      render(<InputRequiredPrompt turn={dataTurn} onSubmit={onSubmit} />);
      await userEvent.type(screen.getByRole('textbox'), 'my-bucket');
      await userEvent.click(screen.getByRole('button', { name: 'Submit' }));
      expect(onSubmit).toHaveBeenCalledWith('input-1', 'my-bucket');
    });
  });

  describe('answered status', () => {
    it('shows answered message instead of input controls', () => {
      render(<InputRequiredPrompt turn={{ ...baseTurn, status: 'answered' }} onSubmit={vi.fn()} />);
      expect(screen.getByText(/response submitted/i)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Yes' })).not.toBeInTheDocument();
    });

    it('shows completed message', () => {
      render(
        <InputRequiredPrompt turn={{ ...baseTurn, status: 'completed' }} onSubmit={vi.fn()} />,
      );
      expect(screen.getByText(/request completed/i)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Yes' })).not.toBeInTheDocument();
    });

    it('shows cancelled message', () => {
      render(
        <InputRequiredPrompt turn={{ ...baseTurn, status: 'cancelled' }} onSubmit={vi.fn()} />,
      );
      expect(screen.getByText(/request cancelled/i)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Yes' })).not.toBeInTheDocument();
    });
  });
});
