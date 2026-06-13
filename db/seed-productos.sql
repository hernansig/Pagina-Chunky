-- ═══════════════════════════════════════════════════════════════════
--  CHUNKY SNKRS — carga inicial de productos
--  Corré esto UNA vez en: Supabase → SQL Editor → New query → Run
--  (después podés editar/agregar/borrar todo desde el panel /admin)
-- ═══════════════════════════════════════════════════════════════════

insert into productos (nombre, precio, talle, foto_url, stock_total, stock_disponible, stock_reservado, activo, orden) values
('Reebok BULC verde/marrón', 5990, '40.5', 'https://lh3.googleusercontent.com/d/1sLUafJ6r1uThu-tbpfodkf8Hm1qFqnB1', 1, 1, 0, true, 1),
('Reebok BULC crema',        4990, '44',   'https://lh3.googleusercontent.com/d/1rjYZd9n5HxOiRotOMx_8w5_EQwK4un4x', 1, 1, 0, true, 2),
('Dunk SB 90s Back Pack',    6990, '36',   'https://lh3.googleusercontent.com/d/1fc_DzNkYBayH4PJivEoEDVMvCC6jRU14', 1, 1, 0, true, 3),
('Dunk SB Court Purple',     6990, '46',   'https://lh3.googleusercontent.com/d/182dZqG_fIId3vUTkl3WY1QeN_O9vTDE4', 1, 1, 0, true, 4),
('Timberland Pro',          11000, '44.5', 'https://lh3.googleusercontent.com/d/1icIvca4-PoRGP4l-p4K48pLE68a9cwm7', 1, 1, 0, true, 5),
('Visera Sullen x NE azul',  3600, null,   'https://lh3.googleusercontent.com/d/18KJwTestG2H0Tea5cEJbCJyDwVNQLprw', 1, 1, 0, true, 6),
('Visera Sullen x NE marrón',4000, null,   'https://lh3.googleusercontent.com/d/1SP4cG8_jkn584OclVCDKujNNcBCyPxis', 1, 1, 0, true, 7),
('Visera Sullen x NE roja',  3500, null,   'https://lh3.googleusercontent.com/d/1lQDlDalmZEasGseaHsaBv86GukyzYN1E', 1, 1, 0, true, 8),
('Remera Jordan x Nina',     4590, 'L',    'https://lh3.googleusercontent.com/d/1BWF_J1__t2yEYn6EqiwmoEACnNACnRk5', 1, 1, 0, true, 9),
('Remera Jordan',            3390, 'M',    'https://lh3.googleusercontent.com/d/1COoZTzA_tCknAvKjs0zALPKmJLMCGemG', 1, 1, 0, true, 10),
('DC Court Graffik',         5800, '41/42','https://lh3.googleusercontent.com/d/1FfC7j343JbG1Xctmasil_UMCUdUydgcr', 1, 1, 0, true, 11),
('Remera Supreme',           4500, 'XL',   'https://lh3.googleusercontent.com/d/1-pIhB_Jdjg6oE5ZMQOPXQuiWwAC3eQ9Q', 1, 1, 0, true, 12),
('Buzo Stussy',              6000, 'XL',   'https://lh3.googleusercontent.com/d/1EI1SUkK19kyJSMk6u1A6pabbzVK59KbA', 1, 1, 0, true, 13),
('New Balance',              6900, '44.5', 'https://lh3.googleusercontent.com/d/1bVwsd2b9YX-zPrQpw9Ijy7PmQCq1hnf4', 1, 1, 0, true, 14);
