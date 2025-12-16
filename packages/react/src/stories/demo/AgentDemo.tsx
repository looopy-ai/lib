import { consumeSSEStream } from '@geee-be/sse-stream-parser';
import { type FC, type ReactNode, useId, useReducer } from 'react';
import { type SubmitHandler, useForm } from 'react-hook-form';
import { Streamdown } from 'streamdown';
import { LucideIcon, type LucideIconName } from '../../components/lucide-icon';
import { ScrollContainer } from '../../components/scroll-container';
import { conversationReducer } from '../../conversation/reducer';
import type { AgentTurn, TaskEvent } from '../../conversation/types';

type Inputs = {
  region: string;
  accountId: string;
  agentId: string;
  accessToken: string;
  contextId: string;
  prompt: string;
};

const Icon: FC<{ name: string | undefined; fallback: ReactNode }> = ({ name, fallback }) => {
  if (!name) return fallback;
  const [type, icon] = name.split(':');
  if (!type) return fallback;
  switch (type) {
    case 'lucide':
      return <LucideIcon name={icon as LucideIconName} fallback={fallback} size="1em" />;
    default:
      return fallback;
  }
};

const thoughtIcons: Record<string, string> = {
  planning: 'lucide:route',
  reasoning: 'lucide:brain',
  reflection: 'lucide:book-check',
  decision: 'lucide:handshake',
  observation: 'lucide:telescope',
  strategy: 'lucide:chess-pawn',
};

const EventComponent: FC<{ event: TaskEvent }> = ({ event }) => {
  switch (event.type) {
    case 'tool-call':
      return (
        <div className="flex items-center gap-1">
          <Icon name={event.icon || 'lucide:drill'} fallback={<span>Tool Call</span>} />{' '}
          {event.toolName}
        </div>
      );
    case 'thought':
      return (
        <div className="flex items-center gap-1">
          <Icon
            name={thoughtIcons[event.thoughtType] || 'lucide:brain'}
            fallback={<span>Tool Call</span>}
          />
          {event.content}
        </div>
      );
  }
};

const initialData = localStorage.getItem('agentDemoData');
const safeParse = (data: string | null) => {
  try {
    if (data) {
      return JSON.parse(data);
    }
  } catch {
    return null;
  }
  return null;
};

export const AgentDemo: FC = () => {
  const [conversationState, dispatch] = useReducer(conversationReducer, {
    turns: new Map<string, AgentTurn>(),
    turnOrder: [],
  });
  const regionInputId = useId();
  const accountInputId = useId();
  const agentInputId = useId();
  const accessTokenInputId = useId();
  const contextInputId = useId();
  const promptInputId = useId();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Inputs>({
    defaultValues: safeParse(initialData) || {
      region: 'us-west-2',
      accountId: '',
      agentId: '',
      accessToken: '',
      contextId: `session-${new Date().toISOString().replace(/[^a-zA-Z0-9]+/g, '-')}`,
      prompt: 'Hey there! :)',
    },
  });

  const onSubmit: SubmitHandler<Inputs> = async (data) => {
    localStorage.setItem('agentDemoData', JSON.stringify(data));
    console.log(data);
    const timestamp = new Date().toISOString();
    const id = `prompt-${timestamp}`;
    dispatch({
      event: 'prompt',
      id,
      data: JSON.stringify({ promptId: id, content: data.prompt, timestamp, metadata: {} }),
    });

    const prompt = data.prompt || 'Hey there! :)';
    const arn = `arn:aws:bedrock-agentcore:${data.region}:${data.accountId}:runtime/${data.agentId}`;
    const escaped_arn = encodeURIComponent(arn).replace(/-/g, '%2D').replace(/_/g, '%5F');
    const url = `https://bedrock-agentcore.${data.region}.amazonaws.com/runtimes/${escaped_arn}/invocations?qualifier=DEFAULT`;
    console.log('Invocation URL:', url);
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'text/event-stream',
        Authorization: `Bearer ${data.accessToken}`,
        'X-Amzn-Bedrock-AgentCore-Runtime-Session-Id': (
          data.contextId || `session-${new Date().toISOString().replace(/[^a-zA-Z0-9]+/g, '-')}`
        ).padStart(33, '~'),
      },
      body: JSON.stringify({ prompt }),
    });
    if (!res.body) throw new Error('No body');

    consumeSSEStream(res.body, (e) => {
      dispatch(e);
      console.log(e.event, e.data);
    }).catch((err) => {
      console.error('Error consuming SSE stream:', err);
    });
  };

  return (
    <ScrollContainer>
      {({ containerRef, showScrollToBottom, scrollToBottom }) => (
        <div className="relative m-0 w-full h-dvh">
          <div ref={containerRef} className="relative overflow-y-auto h-full">
            <form
              onSubmit={handleSubmit(onSubmit)}
              className="max-w-lg mx-auto p-6 bg-white/60 rounded-lg shadow-md backdrop-blur flex flex-col gap-4"
              aria-label="Agent demo form"
            >
              <details className="rounded-md border border-slate-100 bg-white/50 p-3">
                <summary className="cursor-pointer select-none text-sm font-medium text-slate-700">
                  Config (click to expand)
                </summary>
                <div className="grid grid-cols-1 gap-4 mt-2">
                  <div>
                    <label
                      htmlFor={regionInputId}
                      className="block text-sm font-medium text-slate-700"
                    >
                      AWS Region
                    </label>
                    <input
                      id={regionInputId}
                      className="mt-1 block w-full px-3 py-2 border border-slate-200 rounded-md bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="us-west-2"
                      defaultValue=""
                      {...register('region', { required: true })}
                      aria-invalid={errors.region ? 'true' : 'false'}
                    />
                    {errors.region && (
                      <p className="mt-1 text-xs text-red-600">This field is required</p>
                    )}
                  </div>

                  <div>
                    <label
                      htmlFor={accountInputId}
                      className="block text-sm font-medium text-slate-700"
                    >
                      AWS Account ID
                    </label>
                    <input
                      id={accountInputId}
                      className="mt-1 block w-full px-3 py-2 border border-slate-200 rounded-md bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="123456789012"
                      defaultValue=""
                      {...register('accountId', { required: true })}
                      aria-invalid={errors.accountId ? 'true' : 'false'}
                    />
                    {errors.accountId && (
                      <p className="mt-1 text-xs text-red-600">This field is required</p>
                    )}
                  </div>

                  <div>
                    <label
                      htmlFor={agentInputId}
                      className="block text-sm font-medium text-slate-700"
                    >
                      Agent ID
                    </label>
                    <input
                      id={agentInputId}
                      className="mt-1 block w-full px-3 py-2 border border-slate-200 rounded-md bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="agent-1234"
                      defaultValue=""
                      {...register('agentId', { required: true })}
                      aria-invalid={errors.agentId ? 'true' : 'false'}
                    />
                    {errors.agentId && (
                      <p className="mt-1 text-xs text-red-600">This field is required</p>
                    )}
                  </div>

                  <div>
                    <label
                      htmlFor={accessTokenInputId}
                      className="block text-sm font-medium text-slate-700"
                    >
                      Access Token
                    </label>
                    <input
                      id={accessTokenInputId}
                      type="password"
                      className="mt-1 block w-full px-3 py-2 border border-slate-200 rounded-md bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="sk-..."
                      {...register('accessToken', { required: true })}
                      aria-invalid={errors.accessToken ? 'true' : 'false'}
                    />
                    {errors.accessToken && (
                      <p className="mt-1 text-xs text-red-600">This field is required</p>
                    )}
                  </div>

                  <div>
                    <label
                      htmlFor={contextInputId}
                      className="block text-sm font-medium text-slate-700"
                    >
                      Context ID
                    </label>
                    <input
                      id={contextInputId}
                      className="mt-1 block w-full px-3 py-2 border border-slate-200 rounded-md bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="session-123"
                      {...register('contextId', { required: true })}
                      aria-invalid={errors.contextId ? 'true' : 'false'}
                    />
                    {errors.contextId && (
                      <p className="mt-1 text-xs text-red-600">This field is required</p>
                    )}
                  </div>
                </div>
              </details>

              <ul className="space-y-2">
                {Array.from(conversationState.turnOrder).map((id) => {
                  const turn = conversationState.turns.get(id);
                  if (turn?.source === 'client') {
                    return (
                      <li
                        key={id}
                        className="rounded-3xl border border-indigo-300 p-3 shadow-sm bg-indigo-500"
                      >
                        <span className="text-sm text-white text-right italic">
                          <Streamdown>{turn?.prompt}</Streamdown>
                        </span>
                      </li>
                    );
                  }
                  return (
                    <li key={id} className="rounded-md border border-slate-100 p-3 shadow-sm">
                      {turn?.events && turn.events.length > 0 && (
                        <div className="mb-2 rounded bg-slate-50 p-2">
                          <h3 className="text-sm font-semibold text-slate-700">Events:</h3>
                          <ul className="mt-1 space-y-1">
                            {turn.events.map((event) => (
                              <li key={event.id} className="text-sm text-slate-600">
                                <EventComponent event={event} />
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                        <span className="text-sm text-slate-700">
                          <Streamdown>{turn?.stream}</Streamdown>
                        </span>
                        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                          {turn?.status}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>

              <div>
                <label htmlFor={promptInputId} className="block text-sm font-medium text-slate-700">
                  Prompt
                </label>
                <textarea
                  id={promptInputId}
                  rows={4}
                  className="mt-1 block w-full px-3 py-2 border border-slate-200 rounded-md bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="Describe what you'd like the agent to do..."
                  {...register('prompt', { required: true })}
                  aria-invalid={errors.prompt ? 'true' : 'false'}
                />
                {errors.prompt && (
                  <p className="mt-1 text-xs text-red-600">This field is required</p>
                )}
              </div>

              <div className="mt-4 flex items-center justify-end">
                <button
                  type="submit"
                  className="inline-flex items-center px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  Run
                </button>
              </div>
            </form>
          </div>

          {showScrollToBottom && (
            <button
              type="button"
              className="absolute bottom-4 right-4 rounded-full bg-indigo-600 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white shadow-lg transition hover:bg-indigo-700"
              onClick={() => scrollToBottom()}
            >
              Jump to latest
            </button>
          )}
        </div>
      )}
    </ScrollContainer>
  );
};
