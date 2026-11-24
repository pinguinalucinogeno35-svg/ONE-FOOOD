-- Somente desenvolvimento local e CI. Cria os papéis e os bancos com senhas fixas.
-- Em produção os papéis são criados pela migração (sem login) e as senhas
-- ficam no cofre de segredos, nunca em arquivo.

CREATE ROLE onefood_owner LOGIN PASSWORD 'dev_owner' CREATEROLE;
CREATE ROLE onefood_app   LOGIN PASSWORD 'dev_app';
CREATE ROLE onefood_relay LOGIN PASSWORD 'dev_relay';

CREATE DATABASE onefood_dev  OWNER onefood_owner;
CREATE DATABASE onefood_test OWNER onefood_owner;
