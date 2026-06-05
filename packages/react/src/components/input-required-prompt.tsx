import { type FC, useId, useState } from 'react';
import type { InputRequiredTurn, InputType } from '../conversation/types';

// ─── Sub-components for each input type ──────────────────────────────────────

type InputBodyProps = {
  inputType: InputType;
  options?: unknown[];
  onSubmit: (value: unknown) => void;
};

const ConfirmationInput: FC<{ onSubmit: (value: boolean) => void }> = ({ onSubmit }) => (
  <div className="flex gap-2 mt-3">
    <button
      type="button"
      onClick={() => onSubmit(true)}
      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
    >
      Yes
    </button>
    <button
      type="button"
      onClick={() => onSubmit(false)}
      className="px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 text-sm font-medium rounded-md border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
    >
      No
    </button>
  </div>
);

const ClarificationInput: FC<{ onSubmit: (value: string) => void }> = ({ onSubmit }) => {
  const [value, setValue] = useState('');
  const id = useId();
  return (
    <div className="mt-3 flex flex-col gap-2">
      <textarea
        id={id}
        rows={3}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="block w-full px-3 py-2 border border-slate-200 rounded-md bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        placeholder="Type your response…"
      />
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => onSubmit(value)}
          disabled={!value.trim()}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          Submit
        </button>
      </div>
    </div>
  );
};

const SelectionInput: FC<{ options: unknown[]; onSubmit: (value: unknown) => void }> = ({
  options,
  onSubmit,
}) => {
  const [selected, setSelected] = useState<unknown>(null);
  const groupId = useId();
  return (
    <div className="mt-3 flex flex-col gap-2">
      <ul className="space-y-1">
        {options.map((option, i) => {
          const inputId = `${groupId}-${i}`;
          const label = typeof option === 'string' ? option : JSON.stringify(option);
          return (
            <li key={inputId} className="flex items-center gap-2">
              <input
                type="radio"
                id={inputId}
                name={groupId}
                checked={selected === option}
                onChange={() => setSelected(option)}
                className="accent-indigo-600"
              />
              <label htmlFor={inputId} className="text-sm text-slate-700 cursor-pointer">
                {label}
              </label>
            </li>
          );
        })}
      </ul>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => onSubmit(selected)}
          disabled={selected === null}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          Submit
        </button>
      </div>
    </div>
  );
};

const DataInput: FC<{ onSubmit: (value: string) => void }> = ({ onSubmit }) => {
  const [value, setValue] = useState('');
  const id = useId();
  return (
    <div className="mt-3 flex flex-col gap-2">
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="block w-full px-3 py-2 border border-slate-200 rounded-md bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        placeholder="Enter value…"
      />
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => onSubmit(value)}
          disabled={!value.trim()}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          Submit
        </button>
      </div>
    </div>
  );
};

const InputBody: FC<InputBodyProps> = ({ inputType, options, onSubmit }) => {
  switch (inputType) {
    case 'confirmation':
      return <ConfirmationInput onSubmit={onSubmit} />;
    case 'clarification':
      return <ClarificationInput onSubmit={onSubmit} />;
    case 'selection':
      return <SelectionInput options={options ?? []} onSubmit={onSubmit} />;
    case 'data':
      return <DataInput onSubmit={onSubmit} />;
  }
};

// ─── Public component ─────────────────────────────────────────────────────────

export type InputRequiredPromptProps = {
  turn: InputRequiredTurn;
  onSubmit: (inputId: string, value: unknown) => void;
  className?: string;
};

/**
 * Renders an agent input-required request as an interactive prompt.
 * Shows different UI controls based on the inputType and transitions
 * to a readonly "answered" state once submitted.
 */
export const InputRequiredPrompt: FC<InputRequiredPromptProps> = ({
  turn,
  onSubmit,
  className,
}) => {
  const statusMessage =
    turn.status === 'answered'
      ? '✓ Response submitted'
      : turn.status === 'completed'
        ? '✓ Request completed'
        : turn.status === 'cancelled'
          ? '✕ Request cancelled'
          : null;

  const handleSubmit = (value: unknown) => {
    onSubmit(turn.inputId, value);
  };

  return (
    <section
      className={`rounded-md border border-amber-200 bg-amber-50 p-4 shadow-sm ${className ?? ''}`}
      aria-label="Input required"
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 text-amber-600" aria-hidden="true">
          ❓
        </span>
        <div className="flex-1">
          <p className="text-sm font-medium text-amber-900">{turn.prompt}</p>

          {statusMessage ? (
            <p className="mt-2 text-xs text-slate-500 italic">{statusMessage}</p>
          ) : (
            <InputBody inputType={turn.inputType} options={turn.options} onSubmit={handleSubmit} />
          )}
        </div>
      </div>
    </section>
  );
};
