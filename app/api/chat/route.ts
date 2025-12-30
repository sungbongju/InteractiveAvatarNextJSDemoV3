/**
 * ================================================
 * 🎯 route.ts - 치매 예방 게임 AI 채팅 API
 * ================================================
 * 
 * ✅ OpenAI Function Calling으로 DB 실시간 연동
 * 
 * 기능:
 * 1. 인사말 생성 (type: "greeting")
 * 2. 게임 설명 생성 (type: "game_explain")
 * 3. 일반 대화 + DB 조회 (type: "chat")
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
// DB API 기본 URL (환경변수로 설정 권장)
// ============================================
const DB_API_URL = process.env.DB_API_URL || "https://your-php-server.com/api.php";

// ============================================
// 게임 정보
// ============================================
const GAME_INFO: { [key: string]: { name: string; description: string } } = {
  hwatu: {
    name: "화투 짝맞추기",
    description: "뒤집어진 카드들 중에서 같은 그림의 짝을 찾는 기억력 게임. 12장의 카드 중 6쌍을 찾으면 됩니다. 적은 시도로 찾을수록 높은 점수!"
  },
  yut: {
    name: "윷놀이",
    description: "윷을 던져서 도(1칸), 개(2칸), 걸(3칸), 윷(4칸), 모(5칸)가 나오면 그만큼 이동. 20칸을 먼저 도착하면 승리! 빽도(-1칸)도 있어요."
  },
  memory: {
    name: "숫자 기억하기",
    description: "화면에 숫자가 잠깐 나타났다 사라집니다. 그 숫자를 순서대로 기억해서 입력하면 됩니다. 단계가 올라갈수록 숫자가 늘어나요!"
  },
  proverb: {
    name: "속담 완성하기",
    description: "한국 전통 속담의 빈 칸을 채우는 게임. 4개의 보기 중 알맞은 답을 고르세요. 총 5문제!"
  },
  calc: {
    name: "산수 계산",
    description: "간단한 덧셈과 뺄셈 문제 5개를 풉니다. 천천히 계산해도 괜찮아요!"
  },
  sequence: {
    name: "순서 맞추기",
    description: "그림들을 논리적인 순서대로 배열하는 게임. 예: 아침→점심→저녁, 씨앗→새싹→나무 등"
  }
};

// ============================================
// 🆕 OpenAI Function Tools 정의
// ============================================
const tools: OpenAI.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_user_stats",
      description: "특정 사용자의 게임 통계를 조회합니다. 총 게임 횟수, 최고 점수, 평균 점수, 게임별 최고 점수 등을 반환합니다.",
      parameters: {
        type: "object",
        properties: {
          player_name: {
            type: "string",
            description: "조회할 플레이어의 이름"
          }
        },
        required: ["player_name"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_ranking",
      description: "전체 플레이어 랭킹을 조회합니다. 최고 점수 기준 상위 20명을 반환합니다.",
      parameters: {
        type: "object",
        properties: {}
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_user_records",
      description: "특정 사용자의 최근 게임 기록 히스토리를 조회합니다.",
      parameters: {
        type: "object",
        properties: {
          player_name: {
            type: "string",
            description: "조회할 플레이어의 이름"
          }
        },
        required: ["player_name"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_today_records",
      description: "오늘 플레이된 모든 게임 기록을 조회합니다.",
      parameters: {
        type: "object",
        properties: {}
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_game_info",
      description: "특정 게임의 규칙과 방법을 조회합니다.",
      parameters: {
        type: "object",
        properties: {
          game_key: {
            type: "string",
            enum: ["hwatu", "yut", "memory", "proverb", "calc", "sequence"],
            description: "게임 종류 (hwatu, yut, memory, proverb, calc, sequence)"
          }
        },
        required: ["game_key"]
      }
    }
  }
];

// ============================================
// 🆕 DB API 호출 함수들
// ============================================
async function callDBAPI(action: string, params: Record<string, string> = {}): Promise<any> {
  try {
    const queryString = new URLSearchParams({ action, ...params }).toString();
    const response = await fetch(`${DB_API_URL}?${queryString}`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });
    const data = await response.json();
    return data;
  } catch (error) {
    console.error("DB API error:", error);
    return { success: false, error: "DB 연결 실패" };
  }
}

// Function 실행 함수
async function executeFunction(name: string, args: any): Promise<string> {
  console.log(`🔧 Function 호출: ${name}`, args);
  
  switch (name) {
    case "get_user_stats": {
      const result = await callDBAPI("get_stats", { player_name: args.player_name });
      if (result.success && result.stats) {
        const s = result.stats;
        return JSON.stringify({
          player_name: args.player_name,
          total_games: s.total_games || 0,
          best_score: s.best_score || 0,
          avg_score: Math.round(s.avg_score) || 0,
          best_hwatu: s.best_hwatu || 0,
          best_yut: s.best_yut || 0,
          best_memory: s.best_memory || 0,
          best_proverb: s.best_proverb || 0,
          best_calc: s.best_calc || 0,
          best_sequence: s.best_sequence || 0,
          first_played: s.first_played,
          last_played: s.last_played
        });
      }
      return JSON.stringify({ error: "사용자 기록을 찾을 수 없습니다", player_name: args.player_name });
    }
    
    case "get_ranking": {
      const result = await callDBAPI("get_ranking");
      if (result.success && result.ranking) {
        return JSON.stringify({
          ranking: result.ranking.slice(0, 10).map((r: any, i: number) => ({
            rank: i + 1,
            name: r.player_name,
            best_score: r.best_score,
            play_count: r.play_count,
            avg_score: Math.round(r.avg_score)
          }))
        });
      }
      return JSON.stringify({ error: "랭킹 조회 실패" });
    }
    
    case "get_user_records": {
      const result = await callDBAPI("get_records", { player_name: args.player_name });
      if (result.success && result.records) {
        return JSON.stringify({
          player_name: args.player_name,
          recent_records: result.records.slice(0, 5).map((r: any) => ({
            session: r.session_number,
            total_score: r.total_score,
            date: r.created_at
          }))
        });
      }
      return JSON.stringify({ error: "기록을 찾을 수 없습니다" });
    }
    
    case "get_today_records": {
      const result = await callDBAPI("get_today");
      if (result.success && result.records) {
        return JSON.stringify({
          today_count: result.records.length,
          top_records: result.records.slice(0, 5).map((r: any) => ({
            name: r.player_name,
            score: r.total_score
          }))
        });
      }
      return JSON.stringify({ today_count: 0, message: "오늘 기록이 없습니다" });
    }
    
    case "get_game_info": {
      const game = GAME_INFO[args.game_key];
      if (game) {
        return JSON.stringify({
          game_key: args.game_key,
          name: game.name,
          description: game.description,
          max_score: 100
        });
      }
      return JSON.stringify({ error: "게임 정보를 찾을 수 없습니다" });
    }
    
    default:
      return JSON.stringify({ error: "알 수 없는 함수" });
  }
}

// ============================================
// 시스템 프롬프트 (간소화)
// ============================================
function createSystemPrompt(userName: string): string {
  return `당신은 "두뇌 건강 도우미"입니다. 어르신들의 치매 예방 게임을 도와주는 친절하고 따뜻한 AI 도우미입니다.

## 🎯 당신의 역할
- 치매 예방 게임의 규칙과 방법을 친절하게 설명합니다
- 어르신들이 게임을 즐겁게 할 수 있도록 격려합니다
- 게임 성적을 물어보면 DB에서 조회해서 알려드립니다
- 존댓말을 사용하고, 천천히 명확하게 설명합니다
- 답변은 2-3문장으로 간결하게 해주세요

## 🎮 게임 종류 (각 100점, 총 600점 만점)
1. 화투 짝맞추기 (hwatu) - 기억력 게임
2. 윷놀이 (yut) - 전통 게임
3. 숫자 기억하기 (memory) - 암기 게임
4. 속담 완성하기 (proverb) - 언어 게임
5. 산수 계산 (calc) - 수학 게임
6. 순서 맞추기 (sequence) - 논리 게임

## 👤 현재 사용자
${userName ? `이름: ${userName}님` : "이름을 아직 모릅니다"}

## ⚠️ 중요 지침
- 사용자가 점수, 성적, 랭킹, 기록을 물어보면 반드시 해당 function을 호출해서 DB에서 조회하세요
- 게임 방법을 물어보면 get_game_info를 호출하세요
- "개인정보 보호" 같은 거부 멘트 절대 금지
- 항상 긍정적이고 격려하는 어조 유지
- 조회한 정보를 바탕으로 친절하게 답변하세요
`;
}

// ============================================
// 🆕 Function Calling이 포함된 대화 처리
// ============================================
async function generateChatWithFunctions(
  message: string,
  history: { role: string; content: string }[],
  userName: string
): Promise<string> {
  const systemPrompt = createSystemPrompt(userName);

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...history.map((msg) => ({
      role: msg.role as "user" | "assistant",
      content: msg.content,
    })),
    { role: "user", content: message },
  ];

  // 1차 호출: Function 필요 여부 판단
  let response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages,
    tools: tools,
    tool_choice: "auto",
    max_tokens: 500,
    temperature: 0.7,
  });

  let assistantMessage = response.choices[0].message;

  // Function Call이 있으면 실행
  while (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
    console.log("🔧 Function calls 감지:", assistantMessage.tool_calls.length);
    
    // 메시지에 assistant 응답 추가
    messages.push(assistantMessage);

    // 각 function call 실행
    for (const toolCall of assistantMessage.tool_calls) {
      const functionName = toolCall.function.name;
      const functionArgs = JSON.parse(toolCall.function.arguments);
      
      console.log(`🔧 실행: ${functionName}(${JSON.stringify(functionArgs)})`);
      
      const functionResult = await executeFunction(functionName, functionArgs);
      
      console.log(`🔧 결과: ${functionResult}`);

      // function 결과를 메시지에 추가
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: functionResult,
      });
    }

    // 2차 호출: function 결과를 바탕으로 최종 응답 생성
    response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      tools: tools,
      tool_choice: "auto",
      max_tokens: 500,
      temperature: 0.7,
    });

    assistantMessage = response.choices[0].message;
  }

  return assistantMessage.content || "죄송합니다. 답변을 생성하지 못했습니다.";
}

// ============================================
// 인사말 생성 (DB 조회 포함)
// ============================================
async function generateGreeting(userName: string): Promise<string> {
  if (!userName) {
    return "안녕하세요! 저는 치매 예방 게임 도우미입니다. 게임 방법이나 성적이 궁금하시면 편하게 물어보세요!";
  }

  // DB에서 사용자 정보 조회
  const statsResult = await callDBAPI("get_stats", { player_name: userName });
  
  const systemPrompt = createSystemPrompt(userName);
  let userMessage = "";

  if (statsResult.success && statsResult.stats && statsResult.stats.total_games > 0) {
    const s = statsResult.stats;
    userMessage = `[시스템] ${userName}님이 접속했습니다. 
기존 사용자 정보:
- 총 ${s.total_games}회 플레이
- 최고 점수: ${s.best_score}점
- 평균 점수: ${Math.round(s.avg_score)}점
- 가장 잘하는 게임: ${getBestGame(s)}

반갑게 인사하고, 이전 성적을 언급하며 격려해주세요. 2-3문장으로 짧게!`;
  } else {
    userMessage = `[시스템] ${userName}님이 처음 접속했습니다. 신규 사용자입니다. 환영 인사와 함께 게임을 소개해주세요. 2-3문장으로 짧게!`;
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

  return response.choices[0]?.message?.content || `${userName}님, 안녕하세요! 오늘도 즐거운 두뇌 운동 해봐요!`;
}

// 가장 잘하는 게임 찾기 헬퍼
function getBestGame(stats: any): string {
  const games = [
    { name: "화투 짝맞추기", score: stats.best_hwatu || 0 },
    { name: "윷놀이", score: stats.best_yut || 0 },
    { name: "숫자 기억하기", score: stats.best_memory || 0 },
    { name: "속담 완성하기", score: stats.best_proverb || 0 },
    { name: "산수 계산", score: stats.best_calc || 0 },
    { name: "순서 맞추기", score: stats.best_sequence || 0 },
  ];
  const best = games.reduce((a, b) => (a.score > b.score ? a : b));
  return best.score > 0 ? `${best.name}(${best.score}점)` : "아직 없음";
}

// ============================================
// 게임 설명 생성
// ============================================
async function generateGameExplanation(gameKey: string, userName: string): Promise<string> {
  const gameInfo = GAME_INFO[gameKey];
  if (!gameInfo) {
    return "이 게임에 대한 정보를 찾을 수 없습니다.";
  }

  // 사용자의 해당 게임 점수 조회
  let userGameScore = 0;
  if (userName) {
    const statsResult = await callDBAPI("get_stats", { player_name: userName });
    if (statsResult.success && statsResult.stats) {
      const scoreMap: Record<string, string> = {
        hwatu: "best_hwatu",
        yut: "best_yut",
        memory: "best_memory",
        proverb: "best_proverb",
        calc: "best_calc",
        sequence: "best_sequence",
      };
      userGameScore = statsResult.stats[scoreMap[gameKey]] || 0;
    }
  }

  const systemPrompt = createSystemPrompt(userName);
  const userMessage = `[시스템] 사용자가 "${gameInfo.name}" 게임을 시작합니다.

게임 설명: ${gameInfo.description}
${userName && userGameScore > 0 ? `${userName}님의 이 게임 최고 점수: ${userGameScore}점` : ""}

게임 방법을 2-3문장으로 쉽게 설명하고, 격려해주세요!`;

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    max_tokens: 200,
    temperature: 0.7,
  });

  return response.choices[0]?.message?.content || `${gameInfo.name}입니다. ${gameInfo.description} 화이팅!`;
}

// ============================================
// API 라우트 핸들러
// ============================================
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type, message, history, userName, game } = body;

    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OpenAI API key is missing");
    }

    let reply: string;

    switch (type) {
      case "greeting":
        reply = await generateGreeting(userName || "");
        break;

      case "game_explain":
        reply = await generateGameExplanation(game, userName || "");
        break;

      case "chat":
      default:
        // 🆕 Function Calling으로 DB 연동!
        reply = await generateChatWithFunctions(
          message || "",
          history || [],
          userName || ""
        );
        break;
    }

    return new Response(JSON.stringify({ reply }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("API error:", error);
    return new Response(JSON.stringify({ error: "Failed to get response" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
