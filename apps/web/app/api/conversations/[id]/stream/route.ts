import { NextRequest } from 'next/server';

/**
 * GET /api/conversations/[id]/stream
 *
 * SSE stub. Próxima fase: subscribe em canal Supabase Realtime (INSERT em
 * `totum_sdr.messages WHERE conversation_id = :id`) e emitir events.
 *
 * Contrato: text/event-stream, cada mensagem `data: {...json...}\n\n`.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(`event: hello\ndata: ${JSON.stringify({ conversation_id: id, stub: true })}\n\n`)
      );
      // Stub: fecha na hora. Implementação real mantém aberto e faz push.
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
