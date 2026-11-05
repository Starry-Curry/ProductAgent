import type { components } from './generated/api';

export type Item = components['schemas']['ItemView'];
export type User = components['schemas']['UserView'];
export type Experience = components['schemas']['ExperienceView'];
export type Conversation = components['schemas']['ConversationView'];
export type ChatMessage = components['schemas']['ChatMessageView'];
export type Run = components['schemas']['RunView'];
export type Friend = components['schemas']['FriendView'];
export type Gift = components['schemas']['GiftView'];
export type Reminder = components['schemas']['ReminderView'];
export type Memory = components['schemas']['MemoryView'];
export type Health = components['schemas']['HealthView'];
export type DeviceStatus = components['schemas']['DeviceStatusView'];

export async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch('/api' + path, {
    method, credentials: 'same-origin',
    headers: body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });
  if (!response.ok) {
    const value = await response.json().catch(() => ({}));
    throw new Error(typeof value.detail === 'string' ? value.detail : '这次操作没有完成，请检查后再试');
  }
  return response.json();
}

export async function upload(file: File): Promise<{ id: string; url: string }> {
  const form = new FormData();
  form.append('file', file);
  return request('/assets', 'POST', form);
}
