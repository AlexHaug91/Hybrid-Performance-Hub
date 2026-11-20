"""Use the visible Plan card menu in browser regressions."""
def plan_action(page, card, label):
    card.locator('.plan-menu-toggle').click()
    menu = page.locator('#planActionDialog')
    assert menu.is_visible()
    return menu.get_by_role('button', name='Fjern fra planen' if label == 'Fjern' else label, exact=True)
