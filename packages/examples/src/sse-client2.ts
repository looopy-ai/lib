import { consumeSSEStream } from '@geee-be/sse-stream-parser';

const message = process.argv[2] || 'Hey there! :)';
const res = await fetch('http://localhost:3000/sse/ctx-user-123', {
  method: 'POST',
  headers: { Accept: 'text/event-stream' },
  body: JSON.stringify({ message }),
});
if (!res.body) throw new Error('No body');

await consumeSSEStream(res.body, (e) => {
  switch (e.event) {
    case 'task-created':
      console.log('🆕');
      return;
    case 'task-status':
      {
        const data = JSON.parse(e.data);
        console.log('🔄', data.status);
      }
      return;
    case 'thought-stream':
      {
        const data = JSON.parse(e.data);
        console.log('🤔', data.content);
      }
      return;
    case 'task-complete':
      console.log('⏹️', 'complete');
      return;
    case 'llm-usage':
      return;
    case 'content-complete':
      console.log('');
      return;
    case 'content-delta':
      {
        const data = JSON.parse(e.data);
        process.stdout.write(data.delta);
      }
      return;
  }
  if (e.event?.startsWith('tool-')) {
    console.log('🧰', e.event);
    return;
  }
  console.log('📨', e.event);
});
