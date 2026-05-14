-- ============================================================
-- seed-shopify-customers.sql
--
-- One-shot seed for shopify_customers from the 2026-05-14 Shopify
-- export (73 customers, 299 orders rolled up).
--
-- Run this in Supabase Studio AFTER applying migration
-- 20260514_016_shopify_outreach.sql.
--
-- Idempotent: ON CONFLICT (email) DO NOTHING — re-running is safe
-- but will NOT update existing rows. If you re-export from
-- Shopify with fresher data, truncate the table first or
-- generate a fresh seed.
-- ============================================================

begin;

insert into public.shopify_customers (
  shopify_customer_id, email, first_name, last_name, country_code,
  shopify_marketing_consent, shopify_total_spent, shopify_total_orders, shopify_tags,
  first_order_date, last_order_date, orders_count, orders_total_paid, products,
  notes
) values
  ('7736413192271', '123hannahounengbmmqbeemjoh.dpn@inscrlab.com', NULL, NULL, NULL, true, 0.00, 0, NULL, NULL, NULL, 0, 0.0, NULL, NULL),
  ('7055851421775', 'adamfukushima@gmail.com', 'Adam', 'Fukushima', 'US', true, 980.00, 7, ARRAY['appstle_subscription_inactive_customer']::text[], '2025-01-20'::date, '2025-07-20'::date, 7, 980.0, ARRAY['Custom Season Race Plan']::text[], NULL),
  ('6466948628559', 'altubo1246@hotmail.com', 'Raul', 'Delgado', 'PE', true, 1760.00, 19, ARRAY['appstle_subscription_inactive_customer','newsletter']::text[], '2024-10-24'::date, '2026-04-24'::date, 19, 1760.0, ARRAY['Custom Season Race Plan','Stand Up Paddle Board Progressive Monthly Plan']::text[], NULL),
  ('7270083854415', 'arodriguez1907@gmail.com', 'Andres', 'Rodriguez', 'PE', true, 2091.82, 20, ARRAY['appstle_subscription_inactive_customer','Login with Shop','Shop']::text[], '2025-05-21'::date, '2026-04-21'::date, 20, 2091.82, ARRAY['Custom Season Race Plan','Stand Up Paddle Board Progressive Monthly Plan']::text[], NULL),
  ('7871677464655', 'benschlesier@outlook.com', 'Ben', 'Schlesier', 'US', false, 554.28, 4, ARRAY['appstle_subscription_inactive_customer']::text[], '2026-01-20'::date, '2026-04-20'::date, 4, 554.28, ARRAY['Custom Season Race Plan']::text[], NULL),
  ('8051018268751', 'blupaddler@gmail.com', 'Robb', 'Eichelberger', 'US', false, 143.93, 1, ARRAY['appstle_subscription_inactive_customer']::text[], '2026-04-09'::date, '2026-04-09'::date, 1, 143.93, ARRAY['Custom Season Race Plan']::text[], NULL),
  ('6465540784207', 'bob.schade@oceanflight.com', 'Robert', 'Schade', 'US', true, 600.00, 5, ARRAY['appstle_subscription_paused_customer']::text[], '2024-03-11'::date, '2024-07-11'::date, 5, 600.0, ARRAY['Custom Season Race Plan']::text[], NULL),
  ('7651014148175', 'bomborabreak@bigpond.com', NULL, NULL, 'AU', true, 0.00, 0, ARRAY['newsletter']::text[], NULL, NULL, 0, 0.0, NULL, NULL),
  ('8057668304975', 'bradjmcgibben@gmail.com', 'Brad', 'Morales-McGibben', 'US', false, 143.60, 1, ARRAY['appstle_subscription_inactive_customer','Login with Shop','Shop']::text[], '2026-04-12'::date, '2026-04-12'::date, 1, 143.6, ARRAY['Custom Season Race Plan']::text[], NULL),
  ('7848906162255', 'bradwilborne15@gmail.com', 'Donald', 'Wilborne', 'US', false, 279.07, 2, ARRAY['appstle_subscription_inactive_customer','Login with Shop','Shop']::text[], '2026-01-10'::date, '2026-02-10'::date, 2, 279.07, ARRAY['Custom Season Race Plan']::text[], NULL),
  ('7863446175823', 'broemmeldesign@gmail.com', 'J', 'Broemmel', 'US', false, 279.13, 2, ARRAY['appstle_subscription_paused_customer']::text[], '2026-01-17'::date, '2026-02-17'::date, 2, 279.13, ARRAY['Custom Season Race Plan']::text[], NULL),
  ('6585194315855', 'brownordie1@gmail.com', 'Robert', 'Brown', 'US', false, 860.00, 9, ARRAY['appstle_subscription_paused_customer','Login with Shop','Shop']::text[], '2024-05-29'::date, '2025-04-28'::date, 9, 860.0, ARRAY['Custom Season Race Plan','Prone Paddle Board Progressive Monthly Plan']::text[], NULL),
  ('7368203206735', 'brycal4@yahoo.com', 'Bryan', 'Calaman', 'US', true, 160.00, 2, ARRAY['appstle_subscription_inactive_customer','Login with Shop','newsletter','Shop']::text[], '2025-07-01'::date, '2025-08-01'::date, 2, 160.0, ARRAY['Prone Paddle Board Progressive Monthly Plan']::text[], NULL),
  ('6329928319055', 'cheviseconte@yahoo.com', 'Chevise', 'Conte', 'US', false, 360.00, 3, ARRAY['appstle_subscription_inactive_customer','Login with Shop','Shop']::text[], '2024-01-27'::date, '2024-03-27'::date, 3, 360.0, ARRAY['Custom Season Race Plan']::text[], NULL),
  ('7917300449359', 'chloelouu26@gmail.com', 'Chloe', 'Di Betta', NULL, false, 0.00, 0, ARRAY['Login with Shop','Shop']::text[], NULL, NULL, 0, 0.0, NULL, NULL),
  ('6619248066639', 'chriskrussell@icloud.com', 'Christopher', 'Russell', 'US', false, 240.00, 2, ARRAY['appstle_subscription_inactive_customer']::text[], '2024-06-21'::date, '2024-07-21'::date, 2, 240.0, ARRAY['Custom Season Race Plan']::text[], NULL),
  ('7465880813647', 'coleklick@gmail.com', 'Cole', 'Klick', 'US', false, 751.46, 6, ARRAY['appstle_subscription_paused_customer','Login with Shop','Shop']::text[], '2025-08-05'::date, '2026-04-03'::date, 6, 751.46, ARRAY['Custom Season Race Plan','Prone Paddle Board Progressive Monthly Plan','Prone Training Ergo']::text[], NULL),
  ('8062052270159', 'courtney.sutherland@gmail.com', 'Courtney', 'Sutherland', 'AU', false, 140.00, 1, ARRAY['appstle_subscription_inactive_customer']::text[], '2026-04-14'::date, '2026-04-14'::date, 1, 140.0, ARRAY['Custom Season Race Plan']::text[], NULL),
  ('6502425526351', 'danabitt@gmail.com', 'Dana', 'Bittenbender', 'US', true, 480.00, 5, ARRAY['appstle_subscription_paused_customer','Login with Shop','Shop']::text[], '2024-05-10'::date, '2024-09-29'::date, 5, 480.0, ARRAY['Custom Season Race Plan','Prone Paddle Board Progressive Monthly Plan']::text[], NULL),
  ('7268844863567', 'dapaddlerdan@gmail.com', NULL, NULL, 'AU', true, 0.00, 0, ARRAY['newsletter']::text[], NULL, NULL, 0, 0.0, NULL, NULL),
  ('6493113483343', 'daryl2@dollopdigital.com.au', 'Daryl', 'Shaw', NULL, false, 0.00, 0, NULL, NULL, NULL, 0, 0.0, NULL, NULL),
  ('7962131365967', 'dhund2015@outlook.com', 'Dan', 'Hund', 'CA', true, 162.60, 2, ARRAY['appstle_subscription_inactive_customer','Login with Shop','Shop']::text[], '2026-03-04'::date, '2026-04-09'::date, 2, 162.6, ARRAY['Outrigger Canoe Progressive Monthly Plan']::text[], NULL),
  ('6373186404431', 'dibetta1@gmail.com', 'Jenny', 'Di Betta', NULL, false, 80.00, 1, ARRAY['Login with Shop','Shop']::text[], '2025-07-01'::date, '2025-07-01'::date, 1, 80.0, ARRAY['Prone Paddle Board Progressive Monthly Plan']::text[], NULL),
  ('7892648919119', 'dmichaluk@blg.com', 'Daniel', 'J Michaluk', 'CA', false, 425.89, 4, ARRAY['appstle_subscription_inactive_customer','Login with Shop','Shop']::text[], '2026-01-31'::date, '2026-04-28'::date, 4, 564.31, ARRAY['Custom Season Race Plan']::text[], NULL),
  ('7516945973327', 'emailtrishmiller@gmail.com', 'Patricia', 'Miller', 'US', false, 195.06, 1, NULL, '2025-08-28'::date, '2025-08-28'::date, 1, 195.06, ARRAY['SUP Training Ergo']::text[], NULL),
  ('6359244800079', 'g.loren@me.com', 'George', 'Loren', 'US', false, 1405.06, 10, ARRAY['appstle_subscription_paused_customer','Login with Shop','Shop']::text[], '2025-02-18'::date, '2026-04-17'::date, 10, 1405.06, ARRAY['Custom Season Race Plan']::text[], NULL),
  ('6457755435087', 'george@plsek.us', 'George', 'Plsek', 'US', false, 1120.00, 13, ARRAY['appstle_subscription_paused_customer','Login with Shop','Shop']::text[], '2024-03-06'::date, '2025-09-03'::date, 13, 1120.0, ARRAY['Custom Season Race Plan','Prone Paddle Board Progressive Monthly Plan']::text[], NULL),
  ('7345494982735', 'glselko@gmail.com', 'Gabriel', 'Selko', NULL, false, 0.00, 0, ARRAY['Login with Shop','Shop']::text[], NULL, NULL, 0, 0.0, NULL, NULL),
  ('7258131562575', 'glselko@icloud.com', NULL, 'Selko', 'US', false, 420.00, 3, ARRAY['appstle_subscription_inactive_customer']::text[], '2025-05-14'::date, '2025-07-14'::date, 3, 420.0, ARRAY['Custom Season Race Plan']::text[], NULL),
  ('7959060774991', 'harrisonkerr@outlook.com', 'Harrison', 'Kerr', 'AU', true, 280.00, 2, ARRAY['appstle_subscription_inactive_customer','Login with Shop','Shop']::text[], '2026-03-04'::date, '2026-04-04'::date, 2, 280.0, ARRAY['Custom Season Race Plan']::text[], NULL),
  ('7365651431503', 'hschafer1@gmail.com', 'Heather', 'Schafer', 'US', false, 1404.32, 10, ARRAY['appstle_subscription_paused_customer','Login with Shop','Shop']::text[], '2025-06-30'::date, '2026-04-01'::date, 10, 1404.32, ARRAY['Custom Season Race Plan','Prone Training Ergo']::text[], NULL),
  ('7720050262095', 'hualani21@gmail.com', 'Tina', 'Myers', 'US', true, 816.47, 6, ARRAY['appstle_subscription_inactive_customer']::text[], '2025-11-21'::date, '2026-04-21'::date, 6, 816.47, ARRAY['Custom Season Race Plan']::text[], NULL),
  ('6426941096015', 'iferrell06@gmail.com', 'ian', 'ferrell', 'US', true, 836.32, 9, ARRAY['appstle_subscription_inactive_customer']::text[], '2024-02-21'::date, '2026-04-28'::date, 9, 970.0, ARRAY['Custom Season Race Plan','Prone Paddle Board Progressive Monthly Plan']::text[], NULL),
  ('7982996455503', 'jamesharpercase24@gmail.com', 'James', 'Case', 'US', false, 367.98, 3, ARRAY['appstle_subscription_inactive_customer','Login with Shop','Shop']::text[], '2026-03-12'::date, '2026-04-11'::date, 3, 367.98, ARRAY['Custom Season Race Plan','Prone Paddle Board Progressive Monthly Plan']::text[], NULL),
  ('6493502668879', 'jarodholtz@gmail.com', 'Jarod', 'Holtz', 'US', false, 60.00, 1, ARRAY['appstle_subscription_inactive_customer']::text[], '2024-04-02'::date, '2024-04-02'::date, 1, 60.0, ARRAY['Prone Paddle Board Progressive Monthly Plan']::text[], NULL),
  ('6491872591951', 'jaybaikie1@gmail.com', 'Jay', 'Baikie', 'AU', false, 192.00, 2, ARRAY['appstle_subscription_paused_customer']::text[], '2024-03-31'::date, '2024-04-30'::date, 2, 192.0, ARRAY['Custom Season Race Plan']::text[], NULL),
  ('6373189812303', 'jencossie@gmail.com', 'Jenny', 'Cosgrove', NULL, true, 0.00, 0, ARRAY['Login with Shop','newsletter','Shop']::text[], NULL, NULL, 0, 0.0, NULL, NULL),
  ('7141385601103', 'jharandrew@gmail.com', 'Justin', 'Andrew', 'US', false, 420.00, 3, ARRAY['appstle_subscription_inactive_customer']::text[], '2025-03-19'::date, '2025-05-19'::date, 3, 420.0, ARRAY['Custom Season Race Plan']::text[], NULL),
  ('6576919740495', 'jojostars28@gmail.com', 'Joanna', 'Davidson', 'CA', false, 180.00, 3, ARRAY['appstle_subscription_paused_customer','Login with Shop','Shop']::text[], '2024-05-24'::date, '2024-07-24'::date, 3, 180.0, ARRAY['Prone Paddle Board Progressive Monthly Plan']::text[], NULL),
  ('6689474904143', 'joyb35@aol.com', 'joy', 'Brahmst', 'US', true, 2366.26, 17, ARRAY['appstle_subscription_paused_customer','Login with Shop','newsletter','Shop']::text[], '2024-10-03'::date, '2026-03-30'::date, 17, 2366.26, ARRAY['Custom Season Race Plan']::text[], NULL),
  ('7266176335951', 'jp.okeefe7@gmail.com', 'Micah', 'Iverson', 'US', false, 700.00, 5, ARRAY['appstle_subscription_inactive_customer','Login with Shop','Shop']::text[], '2025-05-19'::date, '2026-04-01'::date, 5, 700.0, ARRAY['Custom Season Race Plan']::text[], NULL),
  ('7605820162127', 'julien.couloigner@gmail.com', 'Couloigner', 'Julien', 'FR', false, 246.10, 3, ARRAY['appstle_subscription_paused_customer','Login with Shop','Shop']::text[], '2025-09-23'::date, '2025-11-23'::date, 3, 246.1, ARRAY['Prone Paddle Board Progressive Monthly Plan']::text[], NULL),
  ('6729917464655', 'jwalding@gmail.com', 'Melissa', 'Walding', 'US', true, 989.96, 7, ARRAY['appstle_subscription_inactive_customer','Login with Shop','Shop']::text[], '2025-03-31'::date, '2026-04-11'::date, 7, 989.96, ARRAY['Custom Season Race Plan']::text[], NULL),
  ('6433318797391', 'leonard.duncan7@gmail.com', 'Leonard', 'Duncan', 'US', true, 240.00, 4, ARRAY['appstle_subscription_inactive_customer']::text[], '2024-02-23'::date, '2024-05-23'::date, 4, 240.0, ARRAY['Outrigger Canoe Progressive Monthly Plan']::text[], NULL),
  ('8102024806479', 'lewy_betts@outlook.com', 'lewis', 'betts', NULL, false, 0.00, 0, ARRAY['Login with Shop','Shop']::text[], NULL, NULL, 0, 0.0, NULL, NULL),
  ('6513708564559', 'marcusforbes@xtra.co.nz', 'Marcus', 'Forbes', 'NZ', false, 783.19, 6, ARRAY['appstle_subscription_paused_customer']::text[], '2024-04-20'::date, '2026-04-02'::date, 6, 783.19, ARRAY['Custom Season Race Plan']::text[], NULL),
  ('6551395827791', 'markcwaldeck@bigpond.com', 'Nark', 'Waldeck', 'AU', false, 1140.00, 15, ARRAY['appstle_subscription_inactive_customer','Login with Shop','Shop']::text[], '2024-05-14'::date, '2025-12-02'::date, 15, 1140.0, ARRAY['Prone Paddle Board Progressive Monthly Plan']::text[], NULL),
  ('6329925926991', 'matte.sun@gmail.com', 'Matthew', 'Sun', 'US', true, 960.00, 8, ARRAY['appstle_subscription_inactive_customer','Login with Shop','Shop']::text[], '2024-01-17'::date, '2024-08-17'::date, 8, 960.0, ARRAY['Custom Season Race Plan']::text[], NULL),
  ('7850992959567', 'matthew.ian.holmes@gmail.com', NULL, NULL, 'AU', true, 0.00, 0, ARRAY['newsletter']::text[], NULL, NULL, 0, 0.0, NULL, NULL),
  ('7900784787535', 'millerjdave@gmail.com', 'Dave', 'VanMiller', 'US', false, 82.60, 1, ARRAY['appstle_subscription_inactive_customer','Login with Shop','Shop']::text[], '2026-02-03'::date, '2026-02-03'::date, 1, 82.6, ARRAY['Prone Paddle Board Progressive Monthly Plan']::text[], NULL),
  ('7276887801935', 'morgan.karen.e@gmail.com', 'Karen', 'Morgan', 'US', false, 80.00, 1, ARRAY['appstle_subscription_inactive_customer','Login with Shop','Shop']::text[], '2025-05-25'::date, '2025-05-25'::date, 1, 80.0, ARRAY['Outrigger Canoe Progressive Monthly Plan']::text[], NULL),
  ('6843078770767', 'muirhead7@gmail.com', 'Matt', 'Muirhead', 'US', false, 700.00, 5, ARRAY['appstle_subscription_inactive_customer']::text[], '2024-10-20'::date, '2025-03-20'::date, 5, 700.0, ARRAY['Custom Season Race Plan']::text[], NULL),
  ('6600311210063', 'nbb@tridentity.com', 'Nicholas', 'Brown', 'US', true, 360.00, 5, NULL, '2024-06-08'::date, '2024-10-08'::date, 5, 360.0, ARRAY['Outrigger Canoe Progressive Monthly Plan','Prone Paddle Board Progressive Monthly Plan']::text[], NULL),
  ('7866611564623', 'nwtkayakassociation@gmail.com', 'NWT Kayak', 'Association', 'CA', false, 81.63, 1, ARRAY['appstle_subscription_inactive_customer']::text[], '2026-01-19'::date, '2026-01-19'::date, 1, 81.63, ARRAY['Outrigger Canoe Progressive Monthly Plan']::text[], NULL),
  ('6329925238863', 'oceansoulunlimited@gmail.com', 'Dino', 'Manning', 'US', false, 240.00, 2, ARRAY['appstle_subscription_paused_customer']::text[], '2024-01-17'::date, '2024-02-17'::date, 2, 240.0, ARRAY['Custom Season Race Plan']::text[], NULL),
  ('6496514015311', 'oisinmg@gmail.com', 'Oisin', 'McGrath', 'IE', false, 60.00, 1, ARRAY['appstle_subscription_inactive_customer','Login with Shop','Shop']::text[], '2024-04-05'::date, '2024-04-05'::date, 1, 60.0, ARRAY['Prone Paddle Board Progressive Monthly Plan']::text[], NULL),
  ('7055537995855', 'otakriti@gmail.com', 'Omar', 'Takriti', 'US', false, 160.00, 2, ARRAY['appstle_subscription_inactive_customer','Login with Shop','Shop']::text[], '2025-01-20'::date, '2025-02-20'::date, 2, 160.0, ARRAY['Outrigger Canoe Progressive Monthly Plan']::text[], NULL),
  ('7565284671567', 'paora.monk@gmail.com', 'Paora', 'Monk', 'NZ', false, 981.45, 7, ARRAY['appstle_subscription_inactive_customer','Login with Shop','Shop']::text[], '2025-09-06'::date, '2026-03-28'::date, 7, 981.45, ARRAY['Custom Season Race Plan']::text[], NULL),
  ('7650401976399', 'paul@mediax.tv', NULL, NULL, 'US', true, 0.00, 0, ARRAY['newsletter']::text[], NULL, NULL, 0, 0.0, NULL, NULL),
  ('7514527891535', 'peterlaramore@gmail.com', NULL, NULL, 'US', true, 0.00, 0, ARRAY['newsletter']::text[], NULL, NULL, 0, 0.0, NULL, NULL),
  ('7227741765711', 'pfeiffoliver@gmail.com', 'Oliver', 'Pfeiff', 'CA', true, 480.00, 6, ARRAY['appstle_subscription_inactive_customer','Login with Shop','newsletter','Shop']::text[], '2025-04-26'::date, '2025-09-26'::date, 6, 480.0, ARRAY['Outrigger Canoe Progressive Monthly Plan']::text[], NULL),
  ('6421529165903', 'rls@internationaltroublemakers.com', 'Raymond', 'Sullivan III', 'US', false, 660.00, 5, ARRAY['appstle_subscription_paused_customer','Login with Shop','Shop']::text[], '2024-02-18'::date, '2024-10-05'::date, 5, 660.0, ARRAY['Custom Season Race Plan']::text[], NULL),
  ('6329926746191', 'rlschina@gmail.com', 'Raymond', 'Lawrence', 'US', false, 360.00, 3, ARRAY['appstle_subscription_inactive_customer','Login with Shop','Shop']::text[], '2024-01-29'::date, '2024-03-29'::date, 3, 360.0, ARRAY['Custom Season Race Plan']::text[], NULL),
  ('7258936901711', 'robertcphelps@yahoo.com', 'Robert', 'Phelps', 'US', false, 280.00, 2, ARRAY['appstle_subscription_inactive_customer','Login with Shop','Shop']::text[], '2025-05-15'::date, '2025-06-15'::date, 2, 280.0, ARRAY['Custom Season Race Plan']::text[], NULL),
  ('6364552331343', 'rstrobel1963@gmail.com', 'Rick', 'Strobel', 'US', false, 840.00, 7, ARRAY['appstle_subscription_inactive_customer','Login with Shop','Shop']::text[], '2024-01-22'::date, '2024-07-22'::date, 7, 840.0, ARRAY['Custom Season Race Plan']::text[], NULL),
  ('6494567268431', 'ryanstojanovich412@gmail.com', 'Ryan', 'Stojanovich', 'US', false, 780.00, 13, ARRAY['appstle_subscription_paused_customer','Login with Shop','Shop']::text[], '2024-04-03'::date, '2025-04-03'::date, 13, 780.0, ARRAY['Prone Paddle Board Progressive Monthly Plan']::text[], NULL),
  ('7278326022223', 'seoien75@gmail.com', NULL, NULL, 'AU', true, 0.00, 0, ARRAY['newsletter']::text[], NULL, NULL, 0, 0.0, NULL, NULL),
  ('6683238531151', 'snow.patrick.b@gmail.com', 'Patrick', 'Snow', 'US', true, 160.00, 2, ARRAY['appstle_subscription_inactive_customer','Login with Shop','Shop']::text[], '2024-08-06'::date, '2024-09-06'::date, 2, 160.0, ARRAY['Prone Paddle Board Progressive Monthly Plan']::text[], NULL),
  ('7357997252687', 'sparks.kyle@gmail.com', NULL, NULL, 'AU', true, 0.00, 0, ARRAY['newsletter']::text[], NULL, NULL, 0, 0.0, NULL, NULL),
  ('8008162705487', 'tall.bay386+allpaddling.com@ilovemyemail.net', NULL, NULL, NULL, true, 0.00, 0, NULL, NULL, NULL, 0, 0.0, NULL, NULL),
  ('6374588088399', 'tavanui@gmail.com', 'Tay', 'Soares', 'US', false, 360.00, 3, ARRAY['appstle_subscription_paused_customer','Login with Shop','Shop']::text[], '2024-01-28'::date, '2024-03-28'::date, 3, 360.0, ARRAY['Custom Season Race Plan']::text[], NULL),
  ('7977827237967', 'tpovah@gmail.com', 'Trevor', 'Povah', 'US', false, 287.75, 2, ARRAY['appstle_subscription_inactive_customer','Login with Shop','Shop']::text[], '2026-03-10'::date, '2026-04-10'::date, 2, 287.75, ARRAY['Custom Season Race Plan']::text[], NULL),
  ('6517869969487', 'yvonnechavez@mac.com', 'YVONNE', 'CHAVEZ', 'US', false, 360.00, 4, ARRAY['appstle_subscription_inactive_customer']::text[], '2024-04-22'::date, '2024-07-22'::date, 4, 480.0, ARRAY['Custom Season Race Plan']::text[], NULL)
on conflict (email) do nothing;

-- Sanity check: should be 73
select count(*) as imported_count from public.shopify_customers;

commit;
