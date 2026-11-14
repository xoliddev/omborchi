/** Receipt lines keep the order the cashier scanned them in (UUID keys carry no order). */
export default /* sql */ `
ALTER TABLE sale_lines ADD COLUMN position integer NOT NULL DEFAULT 0;
`;
