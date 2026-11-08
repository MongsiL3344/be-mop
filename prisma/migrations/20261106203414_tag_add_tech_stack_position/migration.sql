-- CreateTable
CREATE TABLE "TechStack" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "TechStack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Position" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (대소문자 무시 고유, 손으로 추가)
CREATE UNIQUE INDEX "TechStack_name_lower_key" ON "TechStack"(lower("name"));

-- CreateIndex (대소문자 무시 고유, 손으로 추가)
CREATE UNIQUE INDEX "Position_name_lower_key" ON "Position"(lower("name"));
