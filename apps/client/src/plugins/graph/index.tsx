import { GraphIcon } from '../../components/icons';
import { registerPlugin } from '../registry';
import { GraphView } from './GraphView';
import './style.css';

/**
 * Graph View: a core view (always on, never listed under Plugins) of the
 * board's connected items as a force graph, at /b/:id/graph. Registered as
 * a platform plugin so it sits with the other views in the View menu and on
 * the rail without the registry knowing it by name.
 */
registerPlugin({
  manifest: {
    id: 'graph',
    order: 90,
    name: 'Graph View',
    description: 'The board’s connected items as a force graph, 3D or 2D.',
    platform: () => true,
  },
  views: [{ id: 'graph', label: 'Graph View', icon: <GraphIcon />, Component: GraphView }],
});
