import { PageHeader } from '@/components/PageHeader';
import { LiveFeed } from './feed';

export const dynamic = 'force-dynamic';

export default function LivePage() {
  return (
    <div>
      <PageHeader
        title="Ao vivo"
        subtitle="Cada mensagem que sai, cada resposta que chega, cada bloqueio de cota"
      />
      <LiveFeed />
    </div>
  );
}
