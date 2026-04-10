import { useParams } from 'react-router-dom';

export default function ServiceDetailPage() {
  const { serviceName } = useParams();
  return (
    <div>
      <h1>Service: {serviceName}</h1>
      <p>Coming next.</p>
    </div>
  );
}
