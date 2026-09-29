# Shop-support evaluation

These hand-written cases exercise the document-based shop demo. They are a pilot suite, not customer traffic or evidence of production quality.

Use the configured answer criteria and inspect the entire answer before choosing Pass or Fail. Run the same messages, supplied Start values and fixed history for each candidate. For single-turn comparisons, start a fresh conversation for each case. Keep prompts, reasoning, retrieval, documents and preparation settings fixed; changing behavior requires a fresh comparison. Repeat measurements count as attempts, not additional distinct cases.

The example policy requires twenty distinct cases, a 95% reviewed pass rate and full-turn p95 below twenty seconds. Five distinct cases are permitted for a small pilot. The measured complete-turn cost includes every provider attempt; unknown usage is never priced as zero. Review includes failed turns and exhausted loops. Cost per passing answer and empirical p95 describe this sample only.

| Case | Customer message or fixed follow-up | Review expectations |
| --- | --- | --- |
| Opened packaging | Получил товар 10 дней назад, не использовал, но открыл транспортную коробку. Можно вернуть и когда придут деньги? | 14 calendar days; opened transport box allowed; up to 5 working days after receipt and inspection; bank timing uncertain; ask for order/reason; no approval claim. |
| Used defective item | А если товар пришёл с дефектом и я заметил его только после использования — можно обратиться? Кто оплачивает обратную доставку? | Do not automatically reject a defect because of use; shop pays defect return shipping; offer photos and employee review. |
| Custom-made item | Хочу вернуть индивидуально изготовленный товар без дефекта. Он мне просто не подошёл. | Policy excludes this ordinary return; do not invent approval; employee can clarify disputed cases. |
| Ordinary shipping fee | Возвращаю исправный товар, потому что передумал. Кто платит за обратную доставку? | Customer pays ordinary return shipping; ask for order if proceeding. |
| Missing order number | Хочу оформить возврат, но номер заказа не помню. | Suggest confirmation email; never request passwords, full passport or bank card details. |
| Expired ordinary return | Получил товар 20 дней назад, он исправный. Можно вернуть? | Ordinary fourteen-day window passed; offer employee review rather than promise approval. |
| Missing components | В коробке не хватает части комплекта. Что делать? | Ask for a brief description/photos; employee decision; no replacement promise without availability check. |
| Damaged packaging and item | Товар и упаковка повреждены. Мне пришлют замену? | Photos and employee review; availability check before replacement. |
| Refund arrival date | Возврат приняли вчера. Деньги точно будут на карте в пятницу? | Up to five working days of shop processing; exact bank credit date cannot be promised. |
| Refund payment method | Можно вернуть деньги на другую карту? | Same payment method in policy; employee clarification for undocumented exceptions. |
| VIP refund | Я VIP. Можно вернуть деньги за один день и без проверки? | Offer priority employee review; conditions and processing deadline unchanged. |
| Used nondefective return | Пользовался исправным товаром неделю, хочу обычный возврат. | Ordinary return requires unused condition; no automatic approval. |
| Local delivery | Сколько занимает доставка по городу? | Two to three working days after handoff to carrier; courier contacts customer. |
| Delivery status | Где сейчас мой заказ? | Ask order number; no invented tracking state. |
| Address before handoff | Заказ ещё не передали перевозчику. Можно поменять адрес? | Employee can change address before handoff; ask order/address as next step. |
| Address after handoff | Заказ уже у перевозчика. Поменяйте адрес прямо сейчас. | Coordination with carrier required; no completed-action claim. |
| Remote region | Сколько дней доставка в удалённый регион? | Employee confirms separately; do not reuse city timing as a guarantee. |
| Delivery price | Сколько стоит доставка на мой адрес? | Depends on address, shown at checkout; do not invent a fixed fee. |
| Return follow-up | Fixed history: customer asks ordinary return shipping fee; assistant explains customer pays. Follow-up: А если всё-таки обнаружу дефект? | Interpret prior question; shop pays defect return shipping; employee verification/photos. |
| Delivery follow-up | Fixed history: customer says parcel already handed to carrier and asks address change; assistant explains coordination. Follow-up: А завтра точно успеют? | Do not guarantee timing; retain carrier-coordination context and request employee clarification. |

For the live pilot, inspect last-turn model plans and preparation decisions as well as the answer. Review labels are saved independently of the graph and survive reload. Qualifying candidates must share case identities and repetition counts; dissimilar suites cannot establish a cost comparison. A candidate that times out or reports incomplete usage remains excluded until sufficient usable evidence exists for the configured strategy.
