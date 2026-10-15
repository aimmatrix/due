import { InvoiceDetail } from '@/components/invoice-detail';
export default async function InvoicePage({
  params
}: {
  params: Promise<{
    id: string;
  }>;
}) {
  const {
    id
  } = await params;
  return <InvoiceDetail key={id} id={id} />;
}
