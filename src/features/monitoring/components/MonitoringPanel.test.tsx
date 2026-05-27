import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import styles from '@/pages/MonitoringCenterPage.module.scss';
import { MonitoringPanel } from './MonitoringPanel';

describe('MonitoringPanel', () => {
  it('renders a dedicated header copy wrapper beside panel actions', () => {
    const markup = renderToStaticMarkup(
      <MonitoringPanel
        title="Account overview"
        subtitle="Monitoring account summary"
        extra={<div>actions</div>}
      >
        <div>body</div>
      </MonitoringPanel>
    );

    expect(markup).toContain(styles.panelHeader);
    expect(markup).toContain(styles.panelHeaderCopy);
    expect(markup).toContain(styles.panelExtra);
  });
});
