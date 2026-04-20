import { LockKeyOpenIcon, SignInIcon } from "@phosphor-icons/react";
import { useForm } from "@tanstack/react-form";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { motion, useReducedMotion } from "motion/react";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth";
import { getEnterAnimationProps, showErrorToast, showSuccessToast } from "@/lib/utils";

export const Route = createFileRoute("/login")({
  beforeLoad: async () => {
    const { data } = await authClient.getSession();

    if (data) {
      throw redirect({ to: "/" });
    }
  },
  component: RouteComponent,
  head: () => ({
    meta: [
      {
        title: "Login | College Project",
      },
    ],
  }),
});

const loginSchema = z.object({
  email: z.email({ message: "Please enter a valid email address" }),
  password: z.string().min(8, { message: "Password must be at least 8 characters" }),
  isRemembered: z.boolean(),
});

function RouteComponent() {
  const navigate = useNavigate();
  const isReducedMotion = useReducedMotion() === true;

  const form = useForm({
    defaultValues: {
      email: "",
      password: "",
      isRemembered: false,
    },
    validators: {
      onSubmit: loginSchema,
    },
    onSubmit: async ({ value }) => {
      const { data, error } = await authClient.signIn.email({
        email: value.email.trim(),
        password: value.password.trim(),
        rememberMe: value.isRemembered,
      });

      if (error) {
        showErrorToast("Something went wrong!", error.message);

        return;
      }

      showSuccessToast("Logged in successfully!", `Welcome back, ${data.user.name}!`);

      navigate({ to: "/" });
    },
  });

  return (
    <motion.main
      className="-mt-32 flex min-h-svh flex-col items-center justify-center"
      {...getEnterAnimationProps(isReducedMotion, 0)}
    >
      <div className="flex w-full max-w-7xl flex-col gap-2">
        <motion.div {...getEnterAnimationProps(isReducedMotion, 0.04, 16)}>
          <Card className="overflow-hidden p-0">
            <CardContent className="grid p-0 md:grid-cols-2">
              <motion.form
                className="p-6 md:p-8"
                {...getEnterAnimationProps(isReducedMotion, 0.08)}
                onSubmit={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  void form.handleSubmit();
                }}
              >
                <FieldGroup>
                  <motion.div
                    className="flex flex-col items-center gap-2 text-center"
                    {...getEnterAnimationProps(isReducedMotion, 0.12)}
                  >
                    <h1 className="flex items-center gap-2 text-2xl font-bold">
                      <LockKeyOpenIcon className="mb-1 size-6 text-primary" weight="duotone" />
                      Welcome back
                    </h1>
                    <p className="text-balance text-muted-foreground">Login to your account</p>
                  </motion.div>

                  <form.Field name="email">
                    {(field) => {
                      const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;

                      return (
                        <Field data-invalid={isInvalid}>
                          <FieldLabel htmlFor={field.name}>Email</FieldLabel>
                          <Input
                            id={field.name}
                            name={field.name}
                            type="email"
                            placeholder="aman@gmail.com"
                            value={field.state.value}
                            onBlur={field.handleBlur}
                            onChange={(e) => field.handleChange(e.target.value)}
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
                            name={field.name}
                            type="password"
                            value={field.state.value}
                            onBlur={field.handleBlur}
                            onChange={(e) => field.handleChange(e.target.value)}
                            aria-invalid={isInvalid}
                          />

                          {isInvalid ? <FieldError errors={field.state.meta.errors} /> : null}
                        </Field>
                      );
                    }}
                  </form.Field>

                  <form.Field name="isRemembered">
                    {(field) => (
                      <Field>
                        <div className="flex items-center gap-2">
                          <Checkbox
                            id={field.name}
                            checked={field.state.value}
                            onCheckedChange={(checked) => field.handleChange(checked === true)}
                            aria-invalid={!field.state.meta.isValid}
                          />
                          <FieldLabel htmlFor={field.name}>Remember me</FieldLabel>
                        </div>
                      </Field>
                    )}
                  </form.Field>

                  <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
                    {([canSubmit, isSubmitting]) => (
                      <Field>
                        <Button type="submit" disabled={!canSubmit}>
                          <SignInIcon className="mb-1 size-4" weight="bold" />
                          {isSubmitting ? "Logging in..." : "Login"}
                        </Button>
                      </Field>
                    )}
                  </form.Subscribe>
                </FieldGroup>
              </motion.form>

              <motion.div
                className="relative hidden bg-primary/10 md:block"
                {...getEnterAnimationProps(isReducedMotion, 0.14, 20)}
              >
                <img
                  src="/login.gif"
                  alt="Login gif"
                  className="absolute inset-0 h-full w-full object-cover"
                />
              </motion.div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </motion.main>
  );
}
