BEGIN;

DELETE FROM leadgen.contacts
WHERE business_email IS NOT NULL
  AND business_email !~* '^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.(co\.uk|com|net|org|ae|biz|info|io|me)$';

COMMIT;
