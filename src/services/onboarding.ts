import OpenAI from "openai";
import "dotenv/config";
import { sqliteDb } from "../db/index.js";
import { generateEmbedding } from "./embeddings.js";
import { updateUserEmbedding, markOnboardingCompleted } from "./auth.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export interface OnboardingMessage {
  role: "user" | "assistant";
  content: string;
}

interface OnboardingSession {
  id: number;
  user_id: number;
  messages: string;
  embedding_generated: number;
  created_at: string;
}

const SYSTEM_PROMPT = `あなたは映画好みを理解するための親しみやすいAIアシスタントです。
ユーザーの映画の好みを把握するために、自然な会話で質問をしてください。

質問例:
- 「最近感動した映画はありますか？」
- 「映画を選ぶとき、何を重視しますか？（ストーリー、映像美、音楽、俳優など）」
- 「洋画と邦画、どちらが好きですか？」
- 「好きなジャンルを教えてください」
- 「どんな気分の時に映画を見ますか？」
- 「印象に残っている映画を3本教えてください」

会話のルール:
1. 一度に1つの質問をする
2. ユーザーの回答に応じて関連する質問をする
3. 3-5回の質問で好みを十分に理解する
4. 親しみやすく、フレンドリーな口調で話す
5. ユーザーが会話を終わらせたい意思を示したら、まとめに移行する

ユーザーが「完了」「終わり」「これで」などと言った場合、または十分な情報が集まったと判断した場合は、
最後に「ありがとうございました！あなたの好みを理解しました。」と返答し、
続けて会話から得られた好みを以下のフォーマットでまとめてください：

【好みの要約】
- 好きなジャンル: ...
- 洋画/邦画の傾向: ...
- 重視するポイント: ...
- その他の特徴: ...`;

export async function getOrCreateOnboardingSession(userId: number): Promise<OnboardingMessage[]> {
  const session = sqliteDb.prepare(`
    SELECT * FROM user_onboarding WHERE user_id = ? ORDER BY created_at DESC LIMIT 1
  `).get(userId) as OnboardingSession | undefined;

  if (session && session.embedding_generated === 0) {
    return JSON.parse(session.messages) as OnboardingMessage[];
  }

  // Create new session with initial message
  const initialMessages: OnboardingMessage[] = [
    {
      role: "assistant",
      content: "こんにちは！あなたにぴったりの映画をおすすめするために、いくつか質問させてください。\n\n最近観て印象に残っている映画はありますか？どんなところが良かったですか？",
    },
  ];

  sqliteDb.prepare(`
    INSERT INTO user_onboarding (user_id, messages)
    VALUES (?, ?)
  `).run(userId, JSON.stringify(initialMessages));

  return initialMessages;
}

export async function processOnboardingChat(
  userId: number,
  userMessage: string
): Promise<{ message: string; isComplete: boolean }> {
  // Get current session
  const session = sqliteDb.prepare(`
    SELECT * FROM user_onboarding WHERE user_id = ? ORDER BY created_at DESC LIMIT 1
  `).get(userId) as OnboardingSession | undefined;

  if (!session) {
    throw new Error("No onboarding session found");
  }

  const messages = JSON.parse(session.messages) as OnboardingMessage[];
  messages.push({ role: "user", content: userMessage });

  // Generate AI response
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ],
    temperature: 0.7,
    max_tokens: 500,
  });

  const assistantMessage = completion.choices[0]?.message?.content || "";
  messages.push({ role: "assistant", content: assistantMessage });

  // Check if conversation is complete
  const isComplete = assistantMessage.includes("【好みの要約】");

  // Update session
  sqliteDb.prepare(`
    UPDATE user_onboarding SET messages = ?, embedding_generated = ?
    WHERE id = ?
  `).run(JSON.stringify(messages), isComplete ? 1 : 0, session.id);

  return { message: assistantMessage, isComplete };
}

export async function completeOnboarding(userId: number): Promise<void> {
  // Get the session
  const session = sqliteDb.prepare(`
    SELECT * FROM user_onboarding WHERE user_id = ? ORDER BY created_at DESC LIMIT 1
  `).get(userId) as OnboardingSession | undefined;

  if (!session) {
    throw new Error("No onboarding session found");
  }

  const messages = JSON.parse(session.messages) as OnboardingMessage[];

  // Extract preference summary from the last assistant message
  const lastAssistantMessage = messages
    .filter((m) => m.role === "assistant")
    .pop();

  if (!lastAssistantMessage) {
    throw new Error("No assistant message found");
  }

  // Create a comprehensive text from the conversation for embedding
  const userResponses = messages
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join(" ");

  // Extract summary if present
  const summaryMatch = lastAssistantMessage.content.match(/【好みの要約】([\s\S]*)/);
  const summary = summaryMatch ? summaryMatch[1] : "";

  // Combine user responses and summary for embedding
  const embeddingText = `映画の好み: ${userResponses} ${summary}`.trim();

  // Generate embedding
  const embedding = await generateEmbedding(embeddingText);

  // Convert to Buffer
  const embeddingBuffer = Buffer.alloc(embedding.length * 4);
  for (let i = 0; i < embedding.length; i++) {
    embeddingBuffer.writeFloatLE(embedding[i]!, i * 4);
  }

  // Update user with preference embedding
  updateUserEmbedding(userId, embeddingBuffer);
  markOnboardingCompleted(userId);

  // Mark session as completed
  sqliteDb.prepare(`
    UPDATE user_onboarding SET embedding_generated = 1 WHERE id = ?
  `).run(session.id);
}

export function getOnboardingHistory(userId: number): OnboardingMessage[] {
  const session = sqliteDb.prepare(`
    SELECT * FROM user_onboarding WHERE user_id = ? ORDER BY created_at DESC LIMIT 1
  `).get(userId) as OnboardingSession | undefined;

  if (!session) {
    return [];
  }

  return JSON.parse(session.messages) as OnboardingMessage[];
}
