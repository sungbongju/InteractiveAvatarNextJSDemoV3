/**
 * ================================================
 * 🎤 Whisper STT API - 음성을 텍스트로 변환
 * ================================================
 * 
 * 경로: app/api/whisper/route.ts
 * ================================================
 */

import { NextRequest } from "next/server";
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const audioFile = formData.get("audio") as File;

    if (!audioFile) {
      return new Response(JSON.stringify({ error: "오디오 파일이 없습니다" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    console.log("🎤 Whisper 요청:", audioFile.name, audioFile.size, "bytes");

    const transcription = await client.audio.transcriptions.create({
      file: audioFile,
      model: "whisper-1",
      language: "ko",  // 한국어
    });

    console.log("🎤 Whisper 결과:", transcription.text);

    return new Response(JSON.stringify({ text: transcription.text }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Whisper API error:", error);
    return new Response(JSON.stringify({ error: "음성 인식 실패" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
