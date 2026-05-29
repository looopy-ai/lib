import type { Meta, StoryObj } from '@storybook/react-vite';
import { AgentDemo } from './agent-demo';

const meta = {
  title: 'Demo',
  component: AgentDemo,
  tags: [],
  parameters: {
    layout: 'fullscreen',
  },
  args: {},
} satisfies Meta<typeof AgentDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Agent: Story = {};
