import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ChartsPage } from './pages/ChartsPage';
import { RangePage } from './pages/RangePage';
import { TrainerPage } from './pages/TrainerPage';

const queryClient = new QueryClient();

/**
 * 라우터 라이브러리를 쓰지 않는다 (P2.md 1절). 경로는 세 개뿐이고 링크는 `<a href>` 전체
 * 로드다 — 서버에 SPA 폴백이 이미 있으므로 어느 주소로 들어와도 같은 번들이 뜬다.
 */
export function App(): React.JSX.Element {
  const path = typeof window === 'undefined' ? '/' : window.location.pathname;
  const isCharts = path === '/charts' || path.startsWith('/charts/');
  const isTrainer = path === '/trainer' || path.startsWith('/trainer/');
  return (
    <QueryClientProvider client={queryClient}>
      {isTrainer ? <TrainerPage /> : isCharts ? <ChartsPage /> : <RangePage />}
    </QueryClientProvider>
  );
}
