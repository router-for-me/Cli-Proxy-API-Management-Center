import { CodingAgentsPanel } from './components/CodingAgentsPanel';
import panelStyles from './components/CodingAgentsPanel.module.scss';

/** Standalone Coding Agents page (sidebar: Gateway → Coding Agents). */
export function CodingAgentsPage() {
  return (
    <div className={panelStyles.page}>
      <CodingAgentsPanel />
    </div>
  );
}
