/**
 * ================================================
 * 🛒 route.ts - 쇼핑몰 AI 상담 API
 * ================================================
 *
 * 고객 DB 정보 기반 OpenAI 응답 생성
 *
 * 기능:
 * 1. 인사말 생성 (type: "greeting")
 * 2. 일반 대화 (type: "chat")
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
// 시스템 프롬프트
// ============================================
function createSystemPrompt(customer: any): string {
  let customerInfo = "";

  if (customer) {
    customerInfo = `
## 👤 현재 고객 정보
- 고객 ID: ${customer.customer_id}
- MBTI 유형: ${customer.mbti_type || "분석 중"}
- E/I (외향/내향): ${customer.ei_result || "?"} (${customer.ei_confidence || "?"})
- S/N (감각/직관): ${customer.sn_result || "?"} (${customer.sn_confidence || "?"})
- T/F (사고/감정): ${customer.tf_result || "?"} (${customer.tf_confidence || "?"})
- J/P (판단/인식): ${customer.jp_result || "?"} (${customer.jp_confidence || "?"})
- 고객 요약: ${customer.summary || "정보 없음"}
- 마케팅 제안: ${customer.marketing_suggestion || "정보 없음"}
- 할인 선호도: ${customer.discount_ratio ? (parseFloat(customer.discount_ratio) * 100).toFixed(1) + "%" : "?"}
- 적립금 선호도: ${customer.points_ratio ? (parseFloat(customer.points_ratio) * 100).toFixed(1) + "%" : "?"}
- 주 구매 요일 집중도: ${customer.weekday_concentration_order || "?"}
- 주 구매 시간 집중도: ${customer.hour_concentration_order || "?"}
- 카테고리 집중도: ${customer.category_concentration_order || "?"}
`;
  }

  return `당신은 "쇼핑엔티몰"의 AI 상담원입니다. 친절하고 전문적인 쇼핑 도우미입니다.

## 🎯 당신의 역할
- 고객의 쇼핑을 도와주는 친절한 AI 상담원
- 고객의 MBTI와 구매 패턴을 분석하여 맞춤형 상담 제공
- 상품 추천, 구매 이력 안내, MBTI 기반 성향 분석

${customerInfo}

## 💬 응답 규칙
1. 존댓말을 사용하고 친근하게 대화합니다
2. 답변은 2-3문장으로 간결하게 합니다
3. 고객 정보를 활용해 개인화된 응답을 합니다
4. MBTI 성향에 맞는 쇼핑 조언을 제공합니다

## 📝 질문별 응답 가이드

### "이전에 뭘 샀지요?" / "구매 내역"
- 고객의 카테고리 집중도와 요약 정보를 바탕으로 답변
- 예: "고객님은 주로 [카테고리] 상품을 많이 구매하셨네요!"

### "한번에 얼마나 사나요?" / "평균 구매금액"
- 할인율, 적립금 비율 등을 참고하여 구매 패턴 설명
- 예: "고객님은 할인 상품을 선호하시는 편이에요!"

### "추천해줘" / "추천 상품"
- MBTI와 마케팅 제안을 바탕으로 맞춤 추천
- 예: "ENFP 성향이신 고객님께는 새로운 트렌드 상품을 추천드려요!"

### "MBTI 맞춰봐" / "내 성향"
- 분석된 MBTI와 각 축의 이유를 설명
- 예: "분석 결과 고객님은 ESFJ 성향이세요! 외향적이고 실용적인 쇼핑을 선호하시네요."

## ⚠️ 주의사항
- 실제 구매 금액이나 상세 주문 내역은 없으므로, MBTI와 성향 분석 위주로 답변
- 개인정보 보호 관련 거부 멘트 금지
- 항상 긍정적이고 도움이 되는 어조 유지
`;
}

// ============================================
// 인사말 생성
// ============================================
async function generateGreeting(customer: any): Promise<string> {
  if (!customer) {
    return "안녕하세요! 쇼핑엔티몰 AI 상담원입니다. 무엇을 도와드릴까요?";
  }

  const systemPrompt = createSystemPrompt(customer);

  const userMessage = `[시스템] 고객 ${customer.customer_id}님이 로그인했습니다.
MBTI: ${customer.mbti_type || "분석 중"}
요약: ${customer.summary || "신규 고객"}

반갑게 인사해주세요. 규칙:
- 이모지 사용 금지
- 2문장 이내로 짧게
- MBTI는 자연스럽게 언급 (예: "분석 결과 ESFJ 성향이시네요")
- 과한 표현 금지 (정말, 너무, 🎉 등 금지)`;

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    max_tokens: 200,
    temperature: 0.8,
  });

  return (
    response.choices[0]?.message?.content ||
    `안녕하세요 ${customer.customer_id}님! 쇼핑엔티몰에 오신 것을 환영합니다!`
  );
}

// ============================================
// 일반 대화
// ============================================
async function generateChat(
  message: string,
  history: { role: string; content: string }[],
  customer: any
): Promise<string> {
  const systemPrompt = createSystemPrompt(customer);

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...history.slice(-10).map((msg) => ({
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

  return (
    response.choices[0]?.message?.content ||
    "죄송합니다. 답변을 생성하지 못했습니다."
  );
}

// ============================================
// API 라우트 핸들러
// ============================================
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type, message, history, customer } = body;

    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OpenAI API key is missing");
    }

    let reply: string;

    switch (type) {
      case "greeting":
        reply = await generateGreeting(customer);
        break;

      case "chat":
      default:
        reply = await generateChat(message || "", history || [], customer);
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
