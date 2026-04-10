import { useParams } from 'react-router-dom';

export default function TraceView() {
  const { traceId } = useParams();
  return (
    <div>
      <h1>Trace: {traceId}</h1>
      <p>Coming next.</p>
    </div>
  );
}
