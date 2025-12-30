/**
 * ================================================
 * 🎯 route.ts - 치매 예방 게임 AI 채팅 API (개선 버전)
 * ================================================
 * 
 * 모든 아바타 발화를 이 파일에서 제어:
 * 1. 인사말 생성 (type: "greeting")
 * 2. 게임 설명 생성 (type: "game_explain")
 * 3. 일반 대화 응답 (type: "chat" 또는 기본)
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
// 게임 정보
// ============================================
const GAME_INFO: { [key: string]: { name: string; description: string } } = {
  hwatu: {
    name: "화투 짝맞추기",
    description: "뒤집어진 카드들 중에서 같은 그림의 짝을 찾는 기억력 게임"
  },
  yut: {
    name: "윷놀이",
    description: "윷을 던져서 나온 결과만큼 말을 움직여 도착점까지 가는 전통 게임"
  },
  memory: {
    name: "숫자 기억하기",
    description: "화면에 나타나는 숫자를 순서대로 기억했다가 입력하는 게임"
  },
  proverb: {
    name: "속담 완성하기",
    description: "한국 전통 속담의 빈 칸에 들어갈 알맞은 말을 고르는 게임"
  },
  calc: {
    name: "산수 계산",
    description: "간단한 덧셈과 뺄셈 문제를 푸는 게임"
  },
  sequence: {
    name: "순서 맞추기",
    description: "그림들을 논리적인 순서대로 배열하는 게임"
  }
};

// ============================================
// 시스템 프롬프트 생성 함수
// ============================================
function createSystemPrompt(userName: string, userStats: any): string {
  
  let prompt = `당신은 "두뇌 건강 도우미"입니다. 어르신들의 치매 예방 게임을 도와주는 친절하고 따뜻한 AI 도우미입니다.

## 🎯 당신의 역할
- 치매 예방 게임의 규칙과 방법을 친절하게 설명합니다
- 어르신들이 게임을 즐겁게 할 수 있도록 격려합니다
- 게임 성적에 대해 물어보면 친절하게 알려드립니다
- 존댓말을 사용하고, 천천히 명확하게 설명합니다
- 답변은 2-3문장으로 간결하게 해주세요

## 🎮 게임 종류 (각 게임 최대 100점, 총 600점 만점)
1. **화투 짝맞추기**: 뒤집어진 화투 패의 짝을 찾는 기억력 게임
2. **윷놀이**: 윷을 던져 도착점까지 이동하는 전통 게임
3. **숫자 기억하기**: 화면의 숫자를 순서대로 기억하는 게임
4. **속담 완성하기**: 한국 전통 속담의 빈 칸을 채우는 게임
5. **산수 계산**: 간단한 덧셈/뺄셈 문제를 푸는 게임
6. **순서 맞추기**: 그림을 논리적 순서로 배열하는 게임

## ⚠️ 매우 중요한 지침
- 절대로 "개인정보 보호", "정보를 제공할 수 없습니다", "프라이버시" 등의 말을 하지 마세요
- 사용자가 자신의 성적, 점수, 기록을 물어보면 반드시 아래 정보를 바탕으로 친절하게 알려주세요
- 성적을 물어볼 때 거부하지 말고, 항상 격려하는 말과 함께 정보를 제공하세요
- 항상 긍정적이고 격려하는 어조를 유지하세요
`;

  // 사용자 정보 추가
  if (userName) {
    prompt += `\n## 👤 현재 사용자 정보\n`;
    prompt += `- **이름**: ${userName}님\n`;
    
    if (userStats && userStats.total_games) {
      prompt += `- **총 게임 횟수**: ${userStats.total_games}회\n`;
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

  return prompt;
}

// ============================================
// 인사말 생성
// ============================================
async function generateGreeting(userName: string, userStats: any): Promise<string> {
  const systemPrompt = createSystemPrompt(userName, userStats);
  
  let userMessage = "";
  
  if (userName && userStats && userStats.total_games) {
    userMessage = `[시스템] ${userName}님이 게임에 접속했습니다. 기존 사용자입니다(${userStats.total_games}회 플레이, 최고점수 ${userStats.best_score}점). 반갑게 인사하고, 이전 성적을 언급하며 격려해주세요. 게임 방법이나 성적이 궁금하면 물어보라고 안내해주세요. 2-3문장으로 짧게 해주세요.`;
  } else if (userName) {
    userMessage = `[시스템] ${userName}님이 처음 게임에 접속했습니다. 신규 사용자입니다. 환영 인사를 하고, 게임을 소개하고, 도움이 필요하면 말씀하라고 안내해주세요. 2-3문장으로 짧게 해주세요.`;
  } else {
    userMessage = `[시스템] 사용자가 접속했습니다. 이름을 모르는 상태입니다. 간단히 인사하고 도움이 필요하면 말씀하라고 안내해주세요. 2문장으로 짧게 해주세요.`;
  }

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage }
    ],
    max_tokens: 200,
    temperature: 0.8,
  });

  return response.choices[0]?.message?.content || "안녕하세요! 치매 예방 게임 도우미입니다. 도움이 필요하시면 말씀해주세요!";
}

// ============================================
// 게임 설명 생성
// ============================================
async function generateGameExplanation(gameKey: string, userName: string, userStats: any): Promise<string> {
  const gameInfo = GAME_INFO[gameKey];
  if (!gameInfo) {
    return "이 게임에 대한 정보를 찾을 수 없습니다.";
  }

  const systemPrompt = createSystemPrompt(userName, userStats);
  
  // 해당 게임의 사용자 점수 가져오기
  let userGameScore = 0;
  if (userStats) {
    const scoreMap: { [key: string]: string } = {
      hwatu: 'best_hwatu',
      yut: 'best_yut',
      memory: 'best_memory',
      proverb: 'best_proverb',
      calc: 'best_calc',
      sequence: 'best_sequence'
    };
    userGameScore = userStats[scoreMap[gameKey]] || 0;
  }

  let userMessage = `[시스템] 사용자가 "${gameInfo.name}" 게임을 시작하려고 합니다. 
이 게임은: ${gameInfo.description}
${userGameScore > 0 ? `사용자의 이 게임 최고 점수: ${userGameScore}점` : '사용자가 이 게임을 처음 합니다.'}

게임 방법을 친절하게 설명해주세요. 2-3문장으로 짧고 명확하게, 어르신이 이해하기 쉽게 설명해주세요. 마지막에 격려의 말을 한마디 해주세요.`;

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage }
    ],
    max_tokens: 200,
    temperature: 0.7,
  });

  return response.choices[0]?.message?.content || `${gameInfo.name} 게임입니다. ${gameInfo.description}. 화이팅!`;
}

// ============================================
// 일반 대화 응답
// ============================================
async function generateChatResponse(
  message: string, 
  history: { role: string; content: string }[], 
  userName: string, 
  userStats: any
): Promise<string> {
  const systemPrompt = createSystemPrompt(userName, userStats);

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...history.map((msg) => ({
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

  return response.choices[0]?.message?.content || "죄송합니다. 답변을 생성하지 못했습니다.";
}

// ============================================
// API 라우트 핸들러
// ============================================
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type, message, history, userName, userStats, game } = body;

    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OpenAI API key is missing");
    }

    let reply: string;

    switch (type) {
      case "greeting":
        // 인사말 생성
        reply = await generateGreeting(userName || '', userStats);
        break;
        
      case "game_explain":
        // 게임 설명 생성
        reply = await generateGameExplanation(game, userName || '', userStats);
        break;
        
      case "chat":
      default:
        // 일반 대화 응답
        reply = await generateChatResponse(
          message || '', 
          history || [], 
          userName || '', 
          userStats
        );
        break;
    }

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
