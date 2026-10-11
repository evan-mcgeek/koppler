// Apps of the stack that are not cloned on this machine.
import { test, expect } from './canvas.ts';

test.describe('with two apps not cloned', () => {
  test.use({ uncloned: ['payments', 'catalog'] });

  test('the side pane says so and offers to look again, instead of naming a command to run', async ({ page }) => {
    const pane = page.getByRole('complementary');
    await expect(pane).toContainText('2 apps are not cloned');
    await expect(pane).not.toContainText('koppler sync');

    // The scan is the server's to run; here it is caught, since the test stack has no folder to scan.
    let asked = 0;
    await page.route('**/rescan?*', route => {
      asked++;
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    });
    const loadedAgain = page.waitForEvent('load');
    await pane.getByRole('button', { name: 'Look for clones again' }).click();
    await loadedAgain;
    expect(asked).toBe(1);
  });

  test('a scan that fails says why and leaves the board as it is', async ({ page }) => {
    await page.route('**/rescan?*', route =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"No stack folder to scan."}' }),
    );
    const again = page.getByRole('complementary').getByRole('button', { name: 'Look for clones again' });
    await again.click();
    await expect(page.getByText('No stack folder to scan.')).toBeVisible();
    await expect(again).toBeEnabled();
  });
});
