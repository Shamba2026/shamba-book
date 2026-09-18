# Ngombe Herdbook — Farm Operating Contract

## Fixed farm facts

- Location: South Kinangop, Kenya.
- Feed unit: kilograms (kg).
- Dairy milk price: KSh 49 per litre.
- Milking sessions: morning, afternoon, evening.
- Milk is delivered daily in the evening.
- Milk is paid weekly on Saturday.
- A Saturday payment covers milk delivered from the preceding Saturday through Friday.
- Dairy animals can leave the herd through sale or culling.
- The bull herd is primarily monitored by weight.
- Animal identification currently uses farmer-friendly nicknames such as Murungu.
- The data model supports future RFID and QR identifiers without replacing the human-friendly nickname.
- Every animal requires a profile photograph.
- Event photographs and attachments are optional but supported.
- M-Pesa transaction codes are recorded as payment evidence.
- No paid subscriptions, spending, live payment transactions, production-data deletion, credential rotation, or real financial/payment messaging may be initiated autonomously.

## Product principles

1. The farmer can keep recording when internet connectivity fails.
2. A record is never described as saved locally unless it was actually persisted locally.
3. Cloud synchronization is a shared-data and backup function, not the only place a new farm record can exist.
4. Animal identity is durable and relationships are explicit.
5. Dairy and bull workflows are intentionally different.
6. Money flows are separated from physical production events.
7. Historical facts remain traceable after corrections.
8. External integrations remain optional until their requirements are verified.
9. Unknown facts are recorded as unknown rather than invented.

## Weather

The application uses South Kinangop as the default weather locality. Exact coordinates are not committed to the public repository.

## Milk week rule

For any milk-delivery date:
- Week start = Saturday.
- Week end = Friday.
- Payment record date = following Saturday.

## Animal identity

The farmer-facing animal code may remain a nickname. The system also maintains an internal immutable identifier. Optional RFID and QR values are additional identifiers.
