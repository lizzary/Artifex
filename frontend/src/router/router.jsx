import { createBrowserRouter } from 'react-router-dom';
import { listPrompts, listTags } from '../api';
import HomePage from '../pages/HomePage';
import ReferenceListPage from '../pages/ReferenceListPage';
import SettingsPage from '../pages/SettingsPage';
import StatisticsPage from '../pages/StatisticsPage';

const router = createBrowserRouter([
  {
    path: '/',
    element: <HomePage />,
  },
  {
    path: '/tags',
    element: <ReferenceListPage loadItems={listTags} translationPrefix="tags" />,
  },
  {
    path: '/prompts',
    element: <ReferenceListPage loadItems={listPrompts} translationPrefix="prompts" />,
  },
  {
    path: '/statistics',
    element: <StatisticsPage />,
  },
  {
    path: '/settings',
    element: <SettingsPage />,
  },
]);

export default router;
