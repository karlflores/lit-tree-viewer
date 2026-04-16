-- Remove example series (cascade deletes characters, relationships, blocks, colours).
DELETE FROM series WHERE id IN (
    '00000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000004',
    '00000000-0000-0000-0000-000000000005',
    '00000000-0000-0000-0000-000000000006'
);

-- Revert Wuthering Heights to unpublished.
UPDATE series SET published = false WHERE id = '00000000-0000-0000-0000-000000000001';

ALTER TABLE series DROP COLUMN published;
