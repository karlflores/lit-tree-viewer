-- Seed: Wuthering Heights by Emily Brontë (34 chapters)
INSERT INTO series (id, title, media_type, unit_label, total_units) VALUES
('00000000-0000-0000-0000-000000000001', 'Wuthering Heights', 'book', 'Chapter', 34);

-- Characters
INSERT INTO characters (id, series_id, name, aliases, introduced_at, died_at) VALUES
('00000000-0000-0000-0001-000000000001', '00000000-0000-0000-0000-000000000001',
    'Heathcliff', ARRAY[]::TEXT[], 1, 34),

('00000000-0000-0000-0001-000000000002', '00000000-0000-0000-0000-000000000001',
    'Catherine Earnshaw', ARRAY['Cathy', 'Mrs Linton'], 1, 16),

('00000000-0000-0000-0001-000000000003', '00000000-0000-0000-0000-000000000001',
    'Hindley Earnshaw', ARRAY[]::TEXT[], 1, 17),

('00000000-0000-0000-0001-000000000004', '00000000-0000-0000-0000-000000000001',
    'Edgar Linton', ARRAY[]::TEXT[], 6, 28),

('00000000-0000-0000-0001-000000000005', '00000000-0000-0000-0000-000000000001',
    'Isabella Linton', ARRAY['Isabella Heathcliff'], 6, 18),

('00000000-0000-0000-0001-000000000006', '00000000-0000-0000-0000-000000000001',
    'Nelly Dean', ARRAY['Ellen Dean'], 1, NULL),

('00000000-0000-0000-0001-000000000007', '00000000-0000-0000-0000-000000000001',
    'Hareton Earnshaw', ARRAY[]::TEXT[], 8, NULL),

('00000000-0000-0000-0001-000000000008', '00000000-0000-0000-0000-000000000001',
    'Young Cathy', ARRAY['Catherine Linton', 'Catherine Earnshaw II'], 17, NULL),

('00000000-0000-0000-0001-000000000009', '00000000-0000-0000-0000-000000000001',
    'Linton Heathcliff', ARRAY[]::TEXT[], 21, 31),

('00000000-0000-0000-0001-000000000010', '00000000-0000-0000-0000-000000000001',
    'Mr Earnshaw', ARRAY[]::TEXT[], 1, 4);

-- Relationships
INSERT INTO relationships (series_id, from_id, to_id, kind, label, directed, introduced_at, ended_at) VALUES

-- Heathcliff & Catherine: the central romance
('00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0001-000000000001', '00000000-0000-0000-0001-000000000002',
    'romantic', 'soul mates', false, 1, NULL),

-- Catherine marries Edgar
('00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0001-000000000002', '00000000-0000-0000-0001-000000000004',
    'romantic', 'wife', false, 9, 16),

-- Hindley & Catherine: siblings
('00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0001-000000000003', '00000000-0000-0000-0001-000000000002',
    'family', 'siblings', false, 1, NULL),

-- Hindley degrades Heathcliff after Mr Earnshaw dies
('00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0001-000000000003', '00000000-0000-0000-0001-000000000001',
    'enemy', 'oppressor', true, 5, 17),

-- Edgar & Isabella: siblings
('00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0001-000000000004', '00000000-0000-0000-0001-000000000005',
    'family', 'siblings', false, 6, NULL),

-- Heathcliff elopes with Isabella (strategic cruelty)
('00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0001-000000000001', '00000000-0000-0000-0001-000000000005',
    'romantic', 'husband', false, 12, 18),

-- Hindley is father of Hareton
('00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0001-000000000003', '00000000-0000-0000-0001-000000000007',
    'parent_child', 'father', true, 8, NULL),

-- Catherine & Edgar are parents of Young Cathy
('00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0001-000000000002', '00000000-0000-0000-0001-000000000008',
    'parent_child', 'mother', true, 17, NULL),

('00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0001-000000000004', '00000000-0000-0000-0001-000000000008',
    'parent_child', 'father', true, 17, NULL),

-- Heathcliff & Isabella are parents of Linton Heathcliff
('00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0001-000000000001', '00000000-0000-0000-0001-000000000009',
    'parent_child', 'father', true, 21, NULL),

('00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0001-000000000005', '00000000-0000-0000-0001-000000000009',
    'parent_child', 'mother', true, 21, NULL),

-- Heathcliff brutalises Hareton, keeps him uneducated as revenge on Hindley
('00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0001-000000000001', '00000000-0000-0000-0001-000000000007',
    'rival', 'ward/instrument', true, 17, NULL),

-- Young Cathy & Linton Heathcliff: forced romance
('00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0001-000000000008', '00000000-0000-0000-0001-000000000009',
    'romantic', 'forced marriage', false, 27, 31),

-- Young Cathy & Hareton: eventual genuine romance
('00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0001-000000000008', '00000000-0000-0000-0001-000000000007',
    'romantic', 'love', false, 32, NULL),

-- Mr Earnshaw brings Heathcliff home
('00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0001-000000000010', '00000000-0000-0000-0001-000000000001',
    'mentor', 'adoptive father', true, 1, 4),

-- Nelly is confidante/observer to all — ally of Earnshaw household
('00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0001-000000000006', '00000000-0000-0000-0001-000000000002',
    'ally', 'confidante', true, 1, NULL),

('00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0001-000000000006', '00000000-0000-0000-0001-000000000008',
    'ally', 'guardian', true, 17, NULL);
