import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { Link, createFileRoute, getRouteApi, useNavigate } from "@tanstack/react-router";
import { motion, useReducedMotion } from "motion/react";
import { z } from "zod";

import { buttonVariants, Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { env } from "@/lib/env";
import {
  fetchApiJson,
  getEnterAnimationProps,
  isRecord,
  showErrorToast,
  showSuccessToast,
} from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/create")({
  component: RouteComponent,
  head: () => ({
    meta: [
      {
        title: "Create | College Project",
      },
    ],
  }),
});

const authenticatedRoute = getRouteApi("/_authenticated");

const createDepartmentAdminSchema = z
  .object({
    departmentName: z.string().trim().min(1, { message: "Department name is required" }).max(120),
    departmentSlug: z.string().trim().min(1, { message: "Department slug is required" }).max(63),
    email: z.email({ message: "Please enter a valid email address" }),
    username: z
      .string()
      .trim()
      .min(3, { message: "Username must be at least 3 characters" })
      .max(32),
    password: z.string().min(8, { message: "Password must be at least 8 characters" }).max(128),
    confirmPassword: z
      .string()
      .min(8, { message: "Confirm password must be at least 8 characters" }),
  })
  .refine((value) => value.password === value.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });

const createStaffSchema = z
  .object({
    email: z.email({ message: "Please enter a valid email address" }),
    username: z
      .string()
      .trim()
      .min(3, { message: "Username must be at least 3 characters" })
      .max(32),
    password: z.string().min(8, { message: "Password must be at least 8 characters" }).max(128),
    confirmPassword: z
      .string()
      .min(8, { message: "Confirm password must be at least 8 characters" }),
  })
  .refine((value) => value.password === value.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });

type CreateResponse = {
  success: boolean;
  message: string;
};

function isCreateResponse(value: unknown): value is CreateResponse {
  return isRecord(value) && typeof value.success === "boolean" && typeof value.message === "string";
}

function CreateFormActions(props: {
  canSubmit: boolean;
  isPending: boolean;
  submitLabel: string;
  onClear: () => void;
}) {
  return (
    <Field>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button
          type="submit"
          className="w-full sm:w-auto"
          disabled={!props.canSubmit || props.isPending}
        >
          {props.isPending ? "Creating..." : props.submitLabel}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="w-full sm:w-auto"
          disabled={props.isPending}
          onClick={props.onClear}
        >
          Clear
        </Button>
      </div>
    </Field>
  );
}

async function postCreateRequest(url: string, payload: Record<string, unknown>) {
  const { response, body } = await fetchApiJson(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok || !isCreateResponse(body) || !body.success) {
    if (isRecord(body) && isRecord(body.data) && Array.isArray(body.data.issues)) {
      const messages = body.data.issues
        .map((issue) => {
          if (!isRecord(issue)) {
            return null;
          }

          if (typeof issue.path !== "string" || typeof issue.message !== "string") {
            return null;
          }

          return `${issue.path}: ${issue.message}`;
        })
        .filter((issue): issue is string => issue !== null);

      if (messages.length > 0) {
        throw new Error(messages.join("; "));
      }
    }

    if (isRecord(body) && typeof body.message === "string") {
      throw new Error(body.message);
    }

    throw new Error("Creation failed.");
  }

  return body;
}

function RouteComponent() {
  const { accessContext } = authenticatedRoute.useRouteContext();
  const isReducedMotion = useReducedMotion() === true;

  if (accessContext.role === "system_admin") {
    return <CreateDepartmentAdminForm />;
  }

  if (accessContext.role === "department_admin") {
    return <CreateStaffForm departmentName={accessContext.department?.name ?? ""} />;
  }

  return (
    <motion.main
      className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-6"
      {...getEnterAnimationProps(isReducedMotion)}
    >
      <motion.div
        className="flex items-center justify-between gap-4"
        {...getEnterAnimationProps(isReducedMotion, 0.04)}
      >
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">Create Access</h1>
          <p className="text-sm text-muted-foreground">
            This account does not have permission to create users.
          </p>
        </div>
        <Link to="/" className={buttonVariants({ variant: "default" })}>
          Back
        </Link>
      </motion.div>
    </motion.main>
  );
}

function CreateDepartmentAdminForm() {
  const navigate = useNavigate();
  const isReducedMotion = useReducedMotion() === true;
  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      postCreateRequest(`${env.VITE_SERVER_URL}/api/access/department-admins`, payload),
    onSuccess: (payload) => {
      showSuccessToast(payload.message);
      navigate({ to: "/" });
    },
    onError: (error) => {
      showErrorToast(error instanceof Error ? error.message : "Creation failed.");
    },
  });

  const form = useForm({
    defaultValues: {
      departmentName: "",
      departmentSlug: "",
      email: "",
      username: "",
      password: "",
      confirmPassword: "",
    },
    validators: {
      onSubmit: createDepartmentAdminSchema,
    },
    onSubmit: async ({ value }) => {
      await mutation.mutateAsync({
        departmentName: value.departmentName,
        departmentSlug: value.departmentSlug,
        email: value.email,
        username: value.username,
        password: value.password,
      });
    },
  });

  return (
    <motion.main
      className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-6"
      {...getEnterAnimationProps(isReducedMotion)}
    >
      <motion.div
        className="flex items-center justify-between gap-4"
        {...getEnterAnimationProps(isReducedMotion, 0.04)}
      >
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">Create Department Admin</h1>
          <p className="text-sm text-muted-foreground">
            Create a department and its admin account in one step.
          </p>
        </div>
        <Link to="/" className={buttonVariants({ variant: "default" })}>
          Back
        </Link>
      </motion.div>

      <motion.div {...getEnterAnimationProps(isReducedMotion, 0.08, 16)}>
        <Card>
          <CardHeader>
            <CardTitle>Department Admin Details</CardTitle>
            <CardDescription>
              Fill in the department details and the admin login details.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void form.handleSubmit();
              }}
            >
              <FieldGroup className="gap-6">
                <div className="grid gap-6 lg:grid-cols-2">
                  <form.Field name="departmentName">
                    {(field) => {
                      const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;

                      return (
                        <Field data-invalid={isInvalid}>
                          <FieldLabel htmlFor={field.name}>Department Name</FieldLabel>
                          <Input
                            id={field.name}
                            value={field.state.value}
                            onBlur={field.handleBlur}
                            onChange={(event) => field.handleChange(event.target.value)}
                            aria-invalid={isInvalid}
                          />
                          {isInvalid ? <FieldError errors={field.state.meta.errors} /> : null}
                        </Field>
                      );
                    }}
                  </form.Field>

                  <form.Field name="departmentSlug">
                    {(field) => {
                      const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;

                      return (
                        <Field data-invalid={isInvalid}>
                          <FieldLabel htmlFor={field.name}>Department Slug</FieldLabel>
                          <Input
                            id={field.name}
                            value={field.state.value}
                            onBlur={field.handleBlur}
                            onChange={(event) => field.handleChange(event.target.value)}
                            aria-invalid={isInvalid}
                          />
                          {isInvalid ? <FieldError errors={field.state.meta.errors} /> : null}
                        </Field>
                      );
                    }}
                  </form.Field>

                  <form.Field name="email">
                    {(field) => {
                      const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;

                      return (
                        <Field data-invalid={isInvalid}>
                          <FieldLabel htmlFor={field.name}>Email</FieldLabel>
                          <Input
                            id={field.name}
                            type="email"
                            value={field.state.value}
                            onBlur={field.handleBlur}
                            onChange={(event) => field.handleChange(event.target.value)}
                            aria-invalid={isInvalid}
                          />
                          {isInvalid ? <FieldError errors={field.state.meta.errors} /> : null}
                        </Field>
                      );
                    }}
                  </form.Field>

                  <form.Field name="username">
                    {(field) => {
                      const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;

                      return (
                        <Field data-invalid={isInvalid}>
                          <FieldLabel htmlFor={field.name}>Username</FieldLabel>
                          <Input
                            id={field.name}
                            value={field.state.value}
                            onBlur={field.handleBlur}
                            onChange={(event) => field.handleChange(event.target.value)}
                            aria-invalid={isInvalid}
                          />
                          {isInvalid ? <FieldError errors={field.state.meta.errors} /> : null}
                        </Field>
                      );
                    }}
                  </form.Field>

                  <form.Field name="password">
                    {(field) => {
                      const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;

                      return (
                        <Field data-invalid={isInvalid}>
                          <FieldLabel htmlFor={field.name}>Password</FieldLabel>
                          <Input
                            id={field.name}
                            type="password"
                            value={field.state.value}
                            onBlur={field.handleBlur}
                            onChange={(event) => field.handleChange(event.target.value)}
                            aria-invalid={isInvalid}
                          />
                          {isInvalid ? <FieldError errors={field.state.meta.errors} /> : null}
                        </Field>
                      );
                    }}
                  </form.Field>

                  <form.Field name="confirmPassword">
                    {(field) => {
                      const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;

                      return (
                        <Field data-invalid={isInvalid}>
                          <FieldLabel htmlFor={field.name}>Confirm Password</FieldLabel>
                          <Input
                            id={field.name}
                            type="password"
                            value={field.state.value}
                            onBlur={field.handleBlur}
                            onChange={(event) => field.handleChange(event.target.value)}
                            aria-invalid={isInvalid}
                          />
                          {isInvalid ? <FieldError errors={field.state.meta.errors} /> : null}
                        </Field>
                      );
                    }}
                  </form.Field>
                </div>

                <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
                  {([canSubmit, isSubmitting]) => (
                    <CreateFormActions
                      canSubmit={canSubmit}
                      isPending={isSubmitting || mutation.isPending}
                      submitLabel="Create Department Admin"
                      onClear={() => {
                        form.reset();
                      }}
                    />
                  )}
                </form.Subscribe>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>
      </motion.div>
    </motion.main>
  );
}

function CreateStaffForm({ departmentName }: { departmentName: string }) {
  const navigate = useNavigate();
  const isReducedMotion = useReducedMotion() === true;
  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      postCreateRequest(`${env.VITE_SERVER_URL}/api/access/staff`, payload),
    onSuccess: (payload) => {
      showSuccessToast(payload.message);
      navigate({ to: "/" });
    },
    onError: (error) => {
      showErrorToast(error instanceof Error ? error.message : "Creation failed.");
    },
  });

  const form = useForm({
    defaultValues: {
      email: "",
      username: "",
      password: "",
      confirmPassword: "",
    },
    validators: {
      onSubmit: createStaffSchema,
    },
    onSubmit: async ({ value }) => {
      await mutation.mutateAsync({
        email: value.email,
        username: value.username,
        password: value.password,
      });
    },
  });

  return (
    <motion.main
      className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-6"
      {...getEnterAnimationProps(isReducedMotion)}
    >
      <motion.div
        className="flex items-center justify-between gap-4"
        {...getEnterAnimationProps(isReducedMotion, 0.04)}
      >
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">Create Staff</h1>
          <p className="text-sm text-muted-foreground">
            Create a staff account for {departmentName}.
          </p>
        </div>
        <Link to="/" className={buttonVariants({ variant: "default" })}>
          Back
        </Link>
      </motion.div>

      <motion.div {...getEnterAnimationProps(isReducedMotion, 0.08, 16)}>
        <Card>
          <CardHeader>
            <CardTitle>Staff Details</CardTitle>
            <CardDescription>Staff accounts have view-only access.</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void form.handleSubmit();
              }}
            >
              <FieldGroup className="gap-6">
                <div className="grid gap-6 lg:grid-cols-2">
                  <form.Field name="email">
                    {(field) => {
                      const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;

                      return (
                        <Field data-invalid={isInvalid}>
                          <FieldLabel htmlFor={field.name}>Email</FieldLabel>
                          <Input
                            id={field.name}
                            type="email"
                            value={field.state.value}
                            onBlur={field.handleBlur}
                            onChange={(event) => field.handleChange(event.target.value)}
                            aria-invalid={isInvalid}
                          />
                          {isInvalid ? <FieldError errors={field.state.meta.errors} /> : null}
                        </Field>
                      );
                    }}
                  </form.Field>

                  <form.Field name="username">
                    {(field) => {
                      const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;

                      return (
                        <Field data-invalid={isInvalid}>
                          <FieldLabel htmlFor={field.name}>Username</FieldLabel>
                          <Input
                            id={field.name}
                            value={field.state.value}
                            onBlur={field.handleBlur}
                            onChange={(event) => field.handleChange(event.target.value)}
                            aria-invalid={isInvalid}
                          />
                          {isInvalid ? <FieldError errors={field.state.meta.errors} /> : null}
                        </Field>
                      );
                    }}
                  </form.Field>

                  <form.Field name="password">
                    {(field) => {
                      const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;

                      return (
                        <Field data-invalid={isInvalid}>
                          <FieldLabel htmlFor={field.name}>Password</FieldLabel>
                          <Input
                            id={field.name}
                            type="password"
                            value={field.state.value}
                            onBlur={field.handleBlur}
                            onChange={(event) => field.handleChange(event.target.value)}
                            aria-invalid={isInvalid}
                          />
                          {isInvalid ? <FieldError errors={field.state.meta.errors} /> : null}
                        </Field>
                      );
                    }}
                  </form.Field>

                  <form.Field name="confirmPassword">
                    {(field) => {
                      const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;

                      return (
                        <Field data-invalid={isInvalid}>
                          <FieldLabel htmlFor={field.name}>Confirm Password</FieldLabel>
                          <Input
                            id={field.name}
                            type="password"
                            value={field.state.value}
                            onBlur={field.handleBlur}
                            onChange={(event) => field.handleChange(event.target.value)}
                            aria-invalid={isInvalid}
                          />
                          {isInvalid ? <FieldError errors={field.state.meta.errors} /> : null}
                        </Field>
                      );
                    }}
                  </form.Field>
                </div>

                <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
                  {([canSubmit, isSubmitting]) => (
                    <CreateFormActions
                      canSubmit={canSubmit}
                      isPending={isSubmitting || mutation.isPending}
                      submitLabel="Create Staff"
                      onClear={() => {
                        form.reset();
                      }}
                    />
                  )}
                </form.Subscribe>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>
      </motion.div>
    </motion.main>
  );
}
