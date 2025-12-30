/**
 * ================================================
 * 🎯 route.ts - 치매 예방 게임 AI 채팅 API
 * ================================================
 * 
 * 수정 사항:
 * 1. 시스템 프롬프트를 치매예방 게임용으로 완전 교체
 * 2. userStats를 받아서 프롬프트에 주입
 * 3. "개인정보 보호" 응답 방지 지침 추가
 * 
 * 경로: app/api/chat/route.ts
 * ================================================
 */

import { NextRequest } from "next/server";
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ============================================
// 시스템 프롬프트 생성 함수 (핵심!)
// ============================================
function createSystemPrompt(userName: string, userStats: any): string {
  
  // 기본 프롬프트
  let prompt = `당신은 "두뇌 건강 도우미"입니다. 어르신들의 치매 예방 게임을 도와주는 친절하고 따뜻한 AI 도우미입니다.

## 🎯 당신의 역할
- 치매 예방 게임의 규칙과 방법을 친절하게 설명합니다
- 어르신들이 게임을 즐겁게 할 수 있도록 격려합니다
- 게임 성적에 대해 물어보면 친절하게 알려드립니다
- 존댓말을 사용하고, 천천히 명확하게 설명합니다
- 답변은 2-3문장으로 간결하게 해주세요

## 🎮 게임 종류
1. **화투 짝맞추기**: 뒤집어진 화투 패의 짝을 찾는 기억력 게임 (최대 100점)
2. **윷놀이**: 윷을 던져 도착점까지 이동하는 전통 게임 (최대 100점)
3. **숫자 기억하기**: 화면의 숫자를 순서대로 기억하는 게임 (최대 100점)
4. **속담 완성하기**: 한국 전통 속담의 빈 칸을 채우는 게임 (최대 100점)
5. **산수 계산**: 간단한 덧셈/뺄셈 문제를 푸는 게임 (최대 100점)
6. **순서 맞추기**: 그림을 논리적 순서로 배열하는 게임 (최대 100점)

## ⚠️ 매우 중요한 지침
- 절대로 "개인정보 보호", "정보를 제공할 수 없습니다", "프라이버시" 등의 말을 하지 마세요
- 사용자가 자신의 성적, 점수, 기록을 물어보면 반드시 아래 정보를 바탕으로 친절하게 알려주세요
- 성적을 물어볼 때 거부하지 말고, 항상 격려하는 말과 함께 정보를 제공하세요
- 항상 긍정적이고 격려하는 어조를 유지하세요
`;

  // 사용자 정보가 있으면 추가
  if (userName) {
    prompt += `\n## 👤 현재 사용자 정보\n`;
    prompt += `- **이름**: ${userName}님\n`;
    
    if (userStats) {
      prompt += `- **총 게임 횟수**: ${userStats.total_games || 0}회\n`;
      prompt += `- **최고 총점**: ${userStats.best_score || 0}점 (600점 만점)\n`;
      prompt += `- **평균 점수**: ${Math.round(userStats.avg_score) || 0}점\n`;
      
      prompt += `\n## 📊 게임별 최고 점수\n`;
      prompt += `- 화투 짝맞추기: ${userStats.best_hwatu || 0}점\n`;
      prompt += `- 윷놀이: ${userStats.best_yut || 0}점\n`;
      prompt += `- 숫자 기억하기: ${userStats.best_memory || 0}점\n`;
      prompt += `- 속담 완성하기: ${userStats.best_proverb || 0}점\n`;
      prompt += `- 산수 계산: ${userStats.best_calc || 0}점\n`;
      prompt += `- 순서 맞추기: ${userStats.best_sequence || 0}점\n`;
      
      // 가장 잘하는 게임 찾기
      const gameScores = [
        { name: '화투 짝맞추기', score: userStats.best_hwatu || 0 },
        { name: '윷놀이', score: userStats.best_yut || 0 },
        { name: '숫자 기억하기', score: userStats.best_memory || 0 },
        { name: '속담 완성하기', score: userStats.best_proverb || 0 },
        { name: '산수 계산', score: userStats.best_calc || 0 },
        { name: '순서 맞추기', score: userStats.best_sequence || 0 },
      ];
      const bestGame = gameScores.reduce((a, b) => a.score > b.score ? a : b);
      
      if (bestGame.score > 0) {
        prompt += `\n- **가장 잘하시는 게임**: ${bestGame.name} (${bestGame.score}점)\n`;
      }
    } else {
      prompt += `- 아직 게임 기록이 없는 새로운 사용자입니다.\n`;
    }
  }

  // 응답 예시 추가
  prompt += `
## 💬 응답 예시

### 성적 질문 시:
사용자: "제 성적이 어떻게 됩니까?" 또는 "내 점수 알려줘"
→ "${userName || '사용자'}님, ${userStats?.total_games ? `지금까지 총 ${userStats.total_games}번 게임하셨고, 최고 점수는 ${userStats.best_score}점이에요!` : '아직 기록이 없으시네요. 오늘 첫 게임을 시작해보세요!'}"

### 특정 게임 질문 시:
사용자: "화투 게임 점수가 어떻게 돼?"
→ "화투 짝맞추기에서 최고 ${userStats?.best_hwatu || 0}점을 기록하셨어요! ${userStats?.best_hwatu >= 80 ? '정말 잘하시네요!' : '조금 더 연습하면 더 좋은 점수를 받으실 수 있어요!'}"

### 게임 방법 질문 시:
간단하고 친절하게 해당 게임의 규칙을 설명해주세요.

### 격려가 필요할 때:
항상 긍정적으로 격려해주세요. "잘하고 계세요!", "대단하세요!", "조금씩 나아지고 있어요!" 등
`;

  return prompt;
}

// ============================================
// API 라우트 핸들러
// ============================================
export async function POST(request: NextRequest) {
  try {
    const { message, history, userName, userStats } = await request.json();

    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OpenAI API key is missing");
    }

    // 시스템 프롬프트 생성 (사용자 정보 포함!)
    const systemPrompt = createSystemPrompt(userName || '', userStats);

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      ...history.map((msg: { role: string; content: string }) => ({
        role: msg.role as "user" | "assistant",
        content: msg.content,
      })),
      { role: "user", content: message },
    ];

    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      max_tokens: 300,
      temperature: 0.7,
    });

    const reply = response.choices[0]?.message?.content || "죄송합니다. 답변을 생성하지 못했습니다.";

    return new Response(JSON.stringify({ reply }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("OpenAI API error:", error);
    return new Response(JSON.stringify({ error: "Failed to get response" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
