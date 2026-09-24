import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Interview } from './Interview';
import * as api from '../lib/api';
import type { ConfigResponse } from '../lib/api';

vi.mock('../lib/api', async () => {
  const actual =
    await vi.importActual<typeof import('../lib/api')>('../lib/api');
  return {
    ...actual,
    fetchConfig: vi.fn(),
    postChat: vi.fn(),
  };
});

const mockedApi = vi.mocked(api);

const CONFIG_READY: ConfigResponse = {
  dbConfigured: true,
  dataDir: '/home/me/.ibai',
  provider: 'Using Ollama: llama2',
};

const CONFIG_NO_PROVIDER: ConfigResponse = {
  dbConfigured: true,
  dataDir: '/home/me/.ibai',
  provider: 'No model configured',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedApi.fetchConfig.mockResolvedValue(CONFIG_READY);
});

describe('Interview chat', () => {
  it('renders the composer + empty prompt once the provider is ready', async () => {
    render(<Interview />);
    expect(
      await screen.findByRole('button', { name: /send/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/your message/i)).toBeInTheDocument();
    expect(screen.getByText(/start the conversation/i)).toBeInTheDocument();
  });

  it('optimistically appends the user turn, POSTs the transcript, appends the reply', async () => {
    const user = userEvent.setup();
    mockedApi.postChat.mockResolvedValue({
      reply: 'What data structure comes to mind?',
    });

    render(<Interview />);
    const input = await screen.findByLabelText(/your message/i);

    await user.type(input, 'How do I start Two Sum?');
    await user.click(screen.getByRole('button', { name: /send/i }));

    // User turn shows immediately (optimistic).
    expect(
      await screen.findByText('How do I start Two Sum?'),
    ).toBeInTheDocument();

    // Posted the transcript ending with the user's turn.
    await waitFor(() =>
      expect(mockedApi.postChat).toHaveBeenCalledWith([
        { role: 'user', content: 'How do I start Two Sum?' },
      ]),
    );

    // The model's reply is appended (the model is the only source of text).
    expect(
      await screen.findByText('What data structure comes to mind?'),
    ).toBeInTheDocument();

    // Composer cleared after send.
    expect(screen.getByLabelText(/your message/i)).toHaveValue('');
  });

  it('sends the full multi-turn transcript on the second turn', async () => {
    const user = userEvent.setup();
    mockedApi.postChat
      .mockResolvedValueOnce({ reply: 'Try a hash map.' })
      .mockResolvedValueOnce({ reply: 'Good — what is the complexity?' });

    render(<Interview />);
    const input = await screen.findByLabelText(/your message/i);

    await user.type(input, 'Give me a hint');
    await user.click(screen.getByRole('button', { name: /send/i }));
    await screen.findByText('Try a hash map.');

    await user.type(input, 'I used a map');
    await user.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() =>
      expect(mockedApi.postChat).toHaveBeenLastCalledWith([
        { role: 'user', content: 'Give me a hint' },
        { role: 'assistant', content: 'Try a hash map.' },
        { role: 'user', content: 'I used a map' },
      ]),
    );
  });

  it('shows the configure-a-model state when no provider is configured', async () => {
    mockedApi.fetchConfig.mockResolvedValue(CONFIG_NO_PROVIDER);
    render(<Interview />);

    expect(
      await screen.findByText(/configure a model to start/i),
    ).toBeInTheDocument();
    // Mentions the required env vars.
    expect(screen.getByText(/ANTHROPIC_API_KEY/)).toBeInTheDocument();
    expect(screen.getByText(/IBAI_OLLAMA_MODEL/)).toBeInTheDocument();
    // No composer in this state.
    expect(screen.queryByLabelText(/your message/i)).not.toBeInTheDocument();
    // Never attempts a chat call.
    expect(mockedApi.postChat).not.toHaveBeenCalled();
  });

  it('on a send error shows an inline banner and PRESERVES the transcript', async () => {
    const user = userEvent.setup();
    mockedApi.postChat.mockRejectedValue(
      new api.ApiError('Could not reach the model provider.', 502),
    );

    render(<Interview />);
    const input = await screen.findByLabelText(/your message/i);

    await user.type(input, 'My reasoning is...');
    await user.click(screen.getByRole('button', { name: /send/i }));

    // Inline error banner (does not crash).
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /could not reach the model provider/i,
    );
    // The user's turn is still visible — the transcript is preserved.
    expect(screen.getByText('My reasoning is...')).toBeInTheDocument();
  });

  it('flips to the configure state when a send returns the provider-required 400', async () => {
    const user = userEvent.setup();
    mockedApi.postChat.mockRejectedValue(
      new api.ApiError('no model configured', 400),
    );

    render(<Interview />);
    const input = await screen.findByLabelText(/your message/i);

    await user.type(input, 'hello');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(
      await screen.findByText(/configure a model to start/i),
    ).toBeInTheDocument();
  });

  it('renders reply text as plain text (XSS-safe via JSX, no HTML injection)', async () => {
    const user = userEvent.setup();
    const payload = '<img src=x onerror="alert(1)">';
    mockedApi.postChat.mockResolvedValue({ reply: payload });

    const { container } = render(<Interview />);
    const input = await screen.findByLabelText(/your message/i);

    await user.type(input, 'try to break me');
    await user.click(screen.getByRole('button', { name: /send/i }));

    // The payload appears as literal text, not as an injected element.
    expect(await screen.findByText(payload)).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });
});
