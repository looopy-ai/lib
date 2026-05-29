import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { InputRequiredPrompt } from '../components/input-required-prompt';
import type { InputRequiredTurn } from '../conversation/types';

const baseTurn: Omit<InputRequiredTurn, 'inputType' | 'options'> = {
  source: 'input-required',
  id: 'input-1',
  inputId: 'input-1',
  requireUser: true,
  prompt: 'Do you want to continue with the deletion?',
  status: 'pending',
  timestamp: new Date().toISOString(),
};

const meta = {
  title: 'Components/InputRequiredPrompt',
  component: InputRequiredPrompt,
  parameters: {
    layout: 'padded',
  },
  args: {
    onSubmit: (inputId, value) => {
      console.log('Input submitted', { inputId, value });
    },
  },
} satisfies Meta<typeof InputRequiredPrompt>;

export default meta;
type Story = StoryObj<typeof meta>;

// ─── Confirmation ─────────────────────────────────────────────────────────────

export const Confirmation: Story = {
  args: {
    turn: {
      ...baseTurn,
      inputType: 'confirmation',
      prompt: 'Are you sure you want to delete this file?',
    },
  },
};

export const ConfirmationAnswered: Story = {
  name: 'Confirmation (answered)',
  args: {
    turn: {
      ...baseTurn,
      inputType: 'confirmation',
      status: 'answered',
      prompt: 'Are you sure you want to delete this file?',
    },
  },
};

// ─── Clarification ────────────────────────────────────────────────────────────

export const Clarification: Story = {
  args: {
    turn: {
      ...baseTurn,
      id: 'input-2',
      inputId: 'input-2',
      inputType: 'clarification',
      prompt: 'Could you clarify what region you want to deploy to?',
    },
  },
};

export const ClarificationAnswered: Story = {
  name: 'Clarification (answered)',
  args: {
    turn: {
      ...baseTurn,
      id: 'input-2',
      inputId: 'input-2',
      inputType: 'clarification',
      status: 'answered',
      prompt: 'Could you clarify what region you want to deploy to?',
    },
  },
};

// ─── Selection ────────────────────────────────────────────────────────────────

export const Selection: Story = {
  args: {
    turn: {
      ...baseTurn,
      id: 'input-3',
      inputId: 'input-3',
      inputType: 'selection',
      prompt: 'Which environment should the deployment target?',
      options: ['development', 'staging', 'production'],
    },
  },
};

export const SelectionAnswered: Story = {
  name: 'Selection (answered)',
  args: {
    turn: {
      ...baseTurn,
      id: 'input-3',
      inputId: 'input-3',
      inputType: 'selection',
      status: 'answered',
      prompt: 'Which environment should the deployment target?',
      options: ['development', 'staging', 'production'],
    },
  },
};

// ─── Data ─────────────────────────────────────────────────────────────────────

export const Data: Story = {
  args: {
    turn: {
      ...baseTurn,
      id: 'input-4',
      inputId: 'input-4',
      inputType: 'data',
      prompt: 'Enter the S3 bucket name to use for deployment artefacts.',
    },
  },
};

export const DataAnswered: Story = {
  name: 'Data (answered)',
  args: {
    turn: {
      ...baseTurn,
      id: 'input-4',
      inputId: 'input-4',
      inputType: 'data',
      status: 'answered',
      prompt: 'Enter the S3 bucket name to use for deployment artefacts.',
    },
  },
};

// ─── Interactive demo ─────────────────────────────────────────────────────────

export const Interactive: Story = {
  render: (args) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [turn, setTurn] = useState<InputRequiredTurn>({
      ...baseTurn,
      id: 'input-interactive',
      inputId: 'input-interactive',
      inputType: 'confirmation',
      prompt: 'Submit to see this turn transition to answered state.',
    });

    return (
      <InputRequiredPrompt
        {...args}
        turn={turn}
        onSubmit={(inputId, value) => {
          console.log('Submitted', { inputId, value });
          setTurn((t) => ({ ...t, status: 'answered' }));
        }}
      />
    );
  },
  args: {
    turn: {
      ...baseTurn,
      inputType: 'confirmation',
    },
  },
};
