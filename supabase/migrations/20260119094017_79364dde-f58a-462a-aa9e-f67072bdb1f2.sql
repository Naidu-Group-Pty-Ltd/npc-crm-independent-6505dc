-- Add is_active column to clients table
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT false;

-- Mark the 41 clients with pipeline notes as active
UPDATE public.clients
SET is_active = true
WHERE id IN (
  '51ba0a84-1b15-4fa7-9089-0a469c83361d',
  'a4170f21-e46a-4a9b-b01d-8577d72c2980',
  '5b5a8b8f-a157-4344-a3a1-c6aca0a8adb9',
  '0874d448-edc7-4710-ab89-9e90551907e3',
  'd58a8a31-2b9d-41f8-b8e7-b393b74d37dd',
  'ea14c306-794d-40bb-88a9-174a24decfa8',
  '8e223f19-cdc7-48dc-bcb3-dde2522413cc',
  'a8a7b6e0-2145-4377-b96e-d517a33dfc7c',
  '6753e768-ec2e-4c67-b1c8-6a35302ed70d',
  '15a76160-0fcf-4f85-804a-498e7ddd9c7e',
  'fc7b5872-8237-4a5b-a73b-aa8912b12282',
  'bd80aa95-f7a7-4fd7-86f8-ff189fece513',
  '8e0a4ece-9dee-4c74-ae15-0052f9f24d38',
  'bdc51b49-f7c4-46c0-b927-ddb0c480e4fd',
  'fe18d981-ed1f-411d-9092-111456b1a5dd',
  'b48a16f8-6ae3-4bfb-bdbd-2289b4ea1c95',
  '8e203922-0f8f-413a-85b5-fdd4f225a139',
  '8f76a381-aad5-4bdb-89de-6dbe3c732472',
  'f5474238-2150-40e3-a6df-ba5f97ace73a',
  '31ecc25b-b627-46b1-885c-084667d79051',
  '279ebec5-43ef-437d-bb68-5ad957a79ce8',
  '46f2f2c9-da23-4736-aad1-9b86484bf334',
  'd6cdae2b-8b8e-45d9-a7cf-2891d630cadf',
  'efa848ab-85c9-40a1-8d91-61bad6602227',
  'f7b2ddbf-604a-4609-a55a-61b60f7d10d9',
  '8af32447-b099-4a8d-bbd6-fe37233eba8c',
  'c0744ecf-d378-4571-a45e-0cd909d8d659',
  '21e64b9f-6e6f-409c-a249-4803554902d0',
  'a712e4be-fb04-4f5d-a746-6f6cd9ff811c',
  '9f35b066-e09f-4cce-8895-97a25fe60b71',
  '2fc6d1ce-6572-4538-9126-4ef4a7427afa',
  'f68fae5d-02e9-4021-b938-5e91584ba999',
  'ac37f56a-28c0-4aa5-9509-fb4b9c7fdfc9',
  'aa5ef93d-0880-4647-b2f0-61b2b86d5188',
  'fa5f866f-5902-4f71-af3a-312cc2042b40',
  '3cab33bc-7e42-4507-b2e0-1bbdb0a98fcd',
  'a6a6bcaf-783a-4d93-8752-1cec36ddc849',
  '67ac8abb-5d17-4e6e-8ae3-1f731b2d4d63',
  '44ba5df9-c2db-4b5d-9a93-c33285f7413a',
  '01e58e96-bc34-4a96-bd6a-e6e4bee9a2e7',
  'fb8e5dfe-8e29-43bc-a15a-d8d6e22d2bba'
);

-- Create index for faster active client queries
CREATE INDEX IF NOT EXISTS idx_clients_is_active ON public.clients(is_active) WHERE is_active = true;