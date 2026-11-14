import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { Receipt } from '../components/Receipt';
import { Loading } from '../components/ui';
import { useI18n } from '../i18n';
import { api } from '../lib/api';
import { useSession } from '../lib/session';

export default function ReceiptPrint() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const { t } = useI18n();
  const { me } = useSession();
  const width = params.get('w') === '58' ? 58 : 80;
  const sale = useQuery({ queryKey: ['sales.get', { id }], queryFn: () => api.call('sales.get', { id }) });
  useEffect(() => {
    if (sale.data && params.get('print') === '1') setTimeout(() => window.print(), 300);
  }, [sale.data, params]);
  if (!sale.data) return <Loading />;
  return (
    <div style={{ background: '#fff', minHeight: '100vh', paddingTop: 12 }}>
      <style>{`@page { size: ${width}mm auto; margin: 3mm; }`}</style>
      <div className="no-print row" style={{ justifyContent: 'center', marginBottom: 12 }}>
        <button className="btn primary" onClick={() => window.print()}>
          {t('receipt.print')}
        </button>
      </div>
      <Receipt sale={sale.data} width={width} settings={me.org.settings} />
    </div>
  );
}
