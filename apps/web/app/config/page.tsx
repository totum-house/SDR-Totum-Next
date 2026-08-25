import { PageHeader } from '@/components/PageHeader';
import { ConfigForm } from './form';
import { getSupabase } from '@/lib/supabase';
import { NotConfigured } from '@/components/NotConfigured';
import { fetchMotorStatus } from '@/lib/motor';

export const dynamic = 'force-dynamic';

export default async function ConfigPage() {
  const supabase = getSupabase();
  if (!supabase) {
    return (
      <div>
        <PageHeader title="Regras globais" />
        <NotConfigured />
      </div>
    );
  }

  const motor = await fetchMotorStatus();

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Regras globais"
        subtitle="Kill switch, cota, janela de atendimento e ritmo"
      />

      <div className="card mb-4 text-sm text-zinc-400">
        <div className="font-medium text-zinc-200">Como estas regras se combinam</div>
        <p className="mt-2">
          O motor lê quatro camadas:{' '}
          <span className="text-zinc-300">hard cap do código</span> →{' '}
          <span className="text-zinc-300">env do deploy</span> →{' '}
          <span className="text-zinc-300">rules.yaml</span> →{' '}
          <span className="text-zinc-300">esta tela</span>.
        </p>
        <p className="mt-2">
          Para <strong>cota</strong>, vale sempre o <strong>menor</strong> valor: esta tela consegue
          abaixar o teto, nunca subir. Para o <strong>kill switch</strong>, qualquer camada consegue
          ligar e nenhuma consegue desligar a das outras — parar tem que ser a operação fácil.
        </p>
        {motor.online && motor.quota ? (
          <p className="mt-2 text-xs text-zinc-500">
            Teto em vigor agora, já com todas as camadas: {motor.quota.limit}/dia ({motor.quota.used}{' '}
            usada(s) hoje).
          </p>
        ) : (
          <p className="mt-2 text-xs text-amber-400">
            Motor offline — o teto em vigor não pôde ser confirmado.
          </p>
        )}
      </div>

      <ConfigForm />
    </div>
  );
}
