import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
const sqsClient = new SQSClient({ region: 'us-east-1' });

const RESULT_QUEUE_URL = process.env.RESULT_QUEUE_URL;
const MAX_DEBT_RATIO = 0.35;
const SALARY_MULTIPLIER_FOR_MANUAL_REVIEW = 5;

export const handler = async (event) => {
  console.log(`Se ha recibido un lote de ${event.Records.length} mensajes de SQS.`);

  for (const message of event.Records) {
    try {
      const messageId = message.messageId;
      const messageBody = message.body;
      console.log(`Procesando Mensaje ID: ${messageId}`);
      console.log(`Cuerpo del Mensaje: ${messageBody}`);

      const request = JSON.parse(messageBody);

      const maxDebtCapacity = calculateMaximumDebtCapacity(request.applicantBaseSalary);
      const currentMonthlyDebt = calculateCurrentMonthlyDebt(request.activeLoans);
      const availableDebtCapacity = maxDebtCapacity - currentMonthlyDebt;
      const newLoanMonthlyPayment = calculateMonthlyPayment(
        request.newLoan.requestedAmount,
        request.newLoan.monthlyInterestRate,
        request.newLoan.requestedTermMonths
      );

      let finalStatus;
      let reason;
      let statusId;

      if (newLoanMonthlyPayment <= availableDebtCapacity) {
        finalStatus = "APROBADO";
        statusId = 2;
        reason = "La cuota del nuevo préstamo es asumible según la capacidad de endeudamiento disponible.";

        const maxLoanAmountForAutoApproval = request.applicantBaseSalary * SALARY_MULTIPLIER_FOR_MANUAL_REVIEW;
        if (request.newLoan.requestedAmount > maxLoanAmountForAutoApproval) {
          finalStatus = "REVISION MANUAL";
          statusId = 5;
          reason = `El monto del préstamo supera ${SALARY_MULTIPLIER_FOR_MANUAL_REVIEW} veces el salario base del solicitante.`;
        }
      } else {
        finalStatus = "RECHAZADO";
        statusId = 3;
        reason = "La cuota del nuevo préstamo supera la capacidad de endeudamiento disponible.";
      }

      console.log(`Decisión final para ${request.applicantEmail}: ${finalStatus}`);
      await sendResultToSqs(request.applicantEmail, finalStatus, reason, statusId, request.newLoan.loanId);
    } catch (e) {
      console.error(`ERROR al procesar el mensaje: ${message.messageId}. Error: ${e.message}`);
      throw new Error("Fallo al procesar un mensaje, se reintentará el lote completo.");
    }
  }

  console.log("Lote de mensajes procesado exitosamente.");
  return;
  };

  const calculateMaximumDebtCapacity = (totalIncome) => {
  return totalIncome * MAX_DEBT_RATIO;
};

const calculateCurrentMonthlyDebt = (loans) => {
  if (!loans || loans.length === 0) {
    console.log("Sin prestamos activos");
    return 0;
  }
  return loans
    .map(loan => calculateMonthlyPayment(loan.requestedAmount, loan.monthlyInterestRate, loan.requestedTermMonths))
    .reduce((sum, current) => sum + current, 0);
};

const calculateMonthlyPayment = (principal, monthlyInterestRate, termInMonths) => {
  if (!principal || !monthlyInterestRate || !termInMonths) {
    return 0;
  }
  const i = monthlyInterestRate;
  const n = termInMonths;
  const rateFactor = Math.pow(1 + i, n);
  const numerator = principal * i * rateFactor;
  const denominator = rateFactor - 1;

  if (denominator === 0) {
    return principal / termInMonths;
  }

  return parseFloat((numerator / denominator).toFixed(2));
};

const sendResultToSqs = async (applicantEmail, status, reason, statusId, loanId) => {
  const result = {
    applicantEmail,
    status,
    reason,
    statusId,
    loanId
  };
  const resultMessageBody = JSON.stringify(result);
  console.log(`Resultado validacion nuevo prestamo: ${resultMessageBody}`);

  const params = {
    QueueUrl: RESULT_QUEUE_URL,
    MessageBody: resultMessageBody,
  };

  try {
    await sqsClient.send(new SendMessageCommand(params));
    console.log(`Resultado enviado a SQS para el solicitante: ${applicantEmail}`);
  } catch (e) {
    console.error(`ERROR al enviar el mensaje a SQS: ${e.message}`);
    throw new Error("No se pudo enviar el mensaje de resultado a SQS.");
  }
};