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
    // 평균 주문 금액 포맷팅
    const avgAmount = customer.avg_order_amount 
      ? Number(customer.avg_order_amount).toLocaleString() + "원"
      : "정보 없음";
    const totalAmount = customer.total_order_amount
      ? Number(customer.total_order_amount).toLocaleString() + "원"
      : "정보 없음";

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

## 💰 구매 정보
- 총 주문 금액: ${totalAmount}
- 총 주문 건수: ${customer.total_order_count || 0}건
- 평균 주문 금액: ${avgAmount}
- 첫 주문일: ${customer.first_order_date || "정보 없음"}
- 마지막 주문일: ${customer.last_order_date || "정보 없음"}
- 회원 등급: ${customer.member_grade || "정보 없음"}
- 지역: ${customer.region_sido || ""} ${customer.region_sigungu || ""}

## 📊 쇼핑 성향
- 할인 선호도: ${customer.discount_ratio ? (parseFloat(customer.discount_ratio) * 100).toFixed(1) + "%" : "?"}
- 적립금 선호도: ${customer.points_ratio ? (parseFloat(customer.points_ratio) * 100).toFixed(1) + "%" : "?"}
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
5. 금액은 반드시 한글로 읽기 쉽게 표현합니다
   - 42000원 → "사만 이천원" 또는 "약 사만원 정도"
   - 212000원 → "이십일만 이천원" 또는 "약 이십만원 정도"
   - 숫자+천원, 숫자+만원 표현 금지 (예: "42천원" ❌)
6. 금지 표현: "프리미엄 쇼핑상품", "프리미엄 상품", "고급 상품" 사용 금지
   - 대신: "고객님 취향에 맞는 상품", "인기 상품", "추천 상품" 사용

## 📝 질문별 응답 가이드

### "이전에 뭘 샀지요?" / "구매 내역"
- 총 주문 건수, 첫 주문일, 마지막 주문일 정보를 활용
- 예: "고객님은 총 5건 주문하셨고, 마지막 주문은 6월 26일이었어요."

### "한번에 얼마나 사나요?" / "평균 구매금액"
- 평균 주문 금액(avg_order_amount)을 한글로 알려주기
- 예: "고객님은 평균 약 사만원 정도 구매하시네요!"

### "추천해줘" / "추천 상품"
- MBTI와 마케팅 제안을 바탕으로 맞춤 추천
- 예: "ESFJ 성향이신 고객님께는 가족/모임용 상품을 추천드려요!"

### "MBTI 맞춰봐" / "내 성향"
- 분석된 MBTI와 각 축의 이유를 설명
- 예: "분석 결과 고객님은 ESFJ 성향이세요! 외향적이고 실용적인 쇼핑을 선호하시네요."

## ⚠️ 주의사항
- 실제 구매 금액이나 상세 주문 내역은 없으므로, MBTI와 성향 분석 위주로 답변
- 개인정보 보호 관련 거부 멘트 금지
- 항상 긍정적이고 도움이 되는 어조 유지

## 🎁 MBTI별 추천 상품 가이드

### E (외향형) - 사교적, 활동적
- 파티용품, 모임용 대용량 식품
- 캠핑/아웃도어 용품
- 선물세트, 단체 구매 상품

### I (내향형) - 조용한, 개인적
- 1인용 간편식, 홈카페 용품
- 독서/취미 용품, 홈케어 제품
- 1인 가전, 개인 힐링 용품

### S (감각형) - 실용적, 현실적
- 실용적 생활용품, 베스트셀러 상품
- 검증된 브랜드, 가성비 상품
- 필수 생필품, 정리수납용품

### N (직관형) - 창의적, 미래지향
- 신상품, 트렌디한 아이템
- 새로운 브랜드, 이색 상품
- 친환경/비건 제품

### T (사고형) - 논리적, 분석적
- 가성비 좋은 상품, 기능성 제품
- 비교분석 가능한 전자제품
- 실용적 건강식품

### F (감정형) - 따뜻한, 공감적
- 선물용 상품, 감성 인테리어
- 친환경/윤리적 제품
- 수제/핸드메이드 상품

### J (판단형) - 계획적, 체계적
- 정기배송 상품, 세트 구성
- 계획구매용 대용량
- 멤버십/구독 서비스

### P (인식형) - 유연한, 즉흥적
- 타임세일, 한정판 상품
- 즉흥구매용 소용량
- 새로운 경험 상품

### MBTI 조합 예시
- ESFJ: 모임용 선물세트, 파티 음식, 가족용 대용량 상품
- ISTJ: 정리수납함, 정기배송 생필품, 검증된 가성비 상품
- ENFP: 트렌디한 신상품, 이색 체험 상품, 친환경 아이템
- INTJ: 프리미엄 1인 가전, 기능성 건강식품, 효율적 생활용품

`;
}

// ============================================
// 인사말 생성
// ============================================
async function generateGreeting(customer: any): Promise<string> {
  if (!customer) {
    return "안녕하세요, 쇼핑엔티몰입니다. 무엇을 도와드릴까요?";
  }

  // 고정 인사말 사용 (GPT 호출 없이 자연스럽게)
  const greetings = [
    "안녕하세요, 쇼핑엔티몰입니다. 궁금하신 점 있으시면 편하게 물어봐 주세요.",
    "안녕하세요, 쇼핑엔티몰 AI 상담원입니다. 무엇을 도와드릴까요?",
    "반갑습니다, 고객님. 오늘 어떤 쇼핑 도움이 필요하신가요?",
    "안녕하세요, 고객님. 상품 추천이나 궁금한 점 있으시면 말씀해 주세요.",
  ];

  // 랜덤 선택
  return greetings[Math.floor(Math.random() * greetings.length)];
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
