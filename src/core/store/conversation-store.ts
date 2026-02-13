/**
 * ConversationStore - port of routa-core ConversationStore.kt
 *
 * In-memory storage for agent conversation histories.
 */

import { Message } from "../models/message";

export interface ConversationStore {
  append(message: Message): Promise<void>;
  getConversation(agentId: string): Promise<Message[]>;
  getLastN(agentId: string, n: number): Promise<Message[]>;
  getByTurnRange(
    agentId: string,
    startTurn: number,
    endTurn: number
  ): Promise<Message[]>;
  getMessageCount(agentId: string): Promise<number>;
  deleteConversation(agentId: string): Promise<void>;
}

export class InMemoryConversationStore implements ConversationStore {
  private conversations = new Map<string, Message[]>();

  async append(message: Message): Promise<void> {
    const messages = this.conversations.get(message.agentId) ?? [];
    messages.push({ ...message });
    this.conversations.set(message.agentId, messages);
  }

  async getConversation(agentId: string): Promise<Message[]> {
    return [...(this.conversations.get(agentId) ?? [])];
  }

  async getLastN(agentId: string, n: number): Promise<Message[]> {
    const messages = this.conversations.get(agentId) ?? [];
    return messages.slice(-n);
  }

  async getByTurnRange(
    agentId: string,
    startTurn: number,
    endTurn: number
  ): Promise<Message[]> {
    const messages = this.conversations.get(agentId) ?? [];
    return messages.filter(
      (m) => m.turn !== undefined && m.turn >= startTurn && m.turn <= endTurn
    );
  }

  async getMessageCount(agentId: string): Promise<number> {
    return (this.conversations.get(agentId) ?? []).length;
  }

  async deleteConversation(agentId: string): Promise<void> {
    this.conversations.delete(agentId);
  }
}
